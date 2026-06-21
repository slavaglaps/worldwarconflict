import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { requireAuthUser } from './lib/auth.mjs';
import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile } from './lib/profiles.mjs';
import {
  activityForWallet,
  base58ToBytes,
  formatAtomicAmount,
  isSolanaPublicKey,
  solanaEnv,
  tokenSummaryForOwner,
} from './lib/solana.mjs';

export const config = { path: '/api/wallet' };

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const WALLET_SCHEMA_RELATIONS = ['wallet_accounts', 'wallet_auth_challenges'];

function isMissingWalletSchema(err) {
  return isMissingRelations(err, WALLET_SCHEMA_RELATIONS);
}

function walletDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    publicKey: row.public_key,
    verifiedAt: row.verified_at,
    tokenBalance: row.token_balance_ui || '0',
    tokenBalanceAtomic: row.token_balance_atomic || '0',
    tokenDecimals: Number(row.token_decimals) || 0,
    updatedAt: row.updated_at,
  };
}

function bytesFromSignature(value) {
  if (Array.isArray(value)) return Buffer.from(value.map(n => Number(n) & 0xff));
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^[0-9a-f]+$/i.test(text) && text.length % 2 === 0) return Buffer.from(text, 'hex');
  try { return Buffer.from(text, 'base64'); } catch (_) {}
  try { return Buffer.from(base58ToBytes(text)); } catch (_) {}
  return null;
}

function verifyWalletSignature(publicKey, message, signature) {
  if (!isSolanaPublicKey(publicKey) || typeof message !== 'string') return false;
  const sig = bytesFromSignature(signature);
  if (!sig || sig.length !== 64) return false;
  const rawPublicKey = Buffer.from(base58ToBytes(publicKey));
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
    format: 'der',
    type: 'spki',
  });
  return verify(null, Buffer.from(message, 'utf8'), key, sig);
}

function challengeMessage(publicKey, nonce, issuedAt) {
  return [
    'Tiny World Builder wallet login',
    'Provider: Phantom',
    'Public key: ' + publicKey,
    'Nonce: ' + nonce,
    'Issued at: ' + issuedAt,
  ].join('\n');
}

async function walletPayload(sql, profile, options = {}) {
  const rows = await sql`
    SELECT *
    FROM wallet_accounts
    WHERE profile_id = ${profile.id}
    ORDER BY verified_at DESC
    LIMIT 1
  `;
  const wallet = rows[0] || null;
  const mint = solanaEnv('TINYWORLD_TOKEN_MINT', '');
  let token = {
    configured: !!mint,
    mint,
    symbol: solanaEnv('TINYWORLD_TOKEN_SYMBOL', 'TINYWORLD'),
    amount: wallet ? (wallet.token_balance_atomic || '0') : '0',
    decimals: wallet ? (Number(wallet.token_decimals) || 0) : 0,
    uiAmount: wallet ? (wallet.token_balance_ui || '0') : '0',
    accounts: [],
  };
  let activity = [];
  if (wallet && wallet.public_key && (options.refresh !== false)) {
    try {
      token = await tokenSummaryForOwner(wallet.public_key, mint);
      activity = await activityForWallet(wallet.public_key, token.accounts);
      await sql`
        UPDATE wallet_accounts
        SET token_balance_atomic = ${token.amount},
            token_balance_ui = ${token.uiAmount},
            token_decimals = ${token.decimals},
            token_accounts = ${sql.json(token.accounts)},
            last_activity = ${sql.json(activity)},
            updated_at = NOW()
        WHERE id = ${wallet.id}
      `;
      wallet.token_balance_atomic = token.amount;
      wallet.token_balance_ui = token.uiAmount;
      wallet.token_decimals = token.decimals;
      wallet.updated_at = new Date().toISOString();
    } catch (err) {
      token.error = err && err.message ? err.message : 'Token lookup failed';
      activity = Array.isArray(wallet.last_activity) ? wallet.last_activity : [];
    }
  } else if (wallet) {
    activity = Array.isArray(wallet.last_activity) ? wallet.last_activity : [];
  }
  return {
    wallet: walletDto(wallet),
    token: Object.assign({}, token, {
      uiAmount: token.uiAmount || formatAtomicAmount(token.amount, token.decimals),
    }),
    activity,
  };
}

export default async function walletFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;

  try {
    const sql = getSql();
    const profile = await ensureProfile(auth.user);

    if (request.method === 'GET') {
      return jsonResponse(await walletPayload(sql, profile), origin);
    }

    if (request.method !== 'POST') return errorResponse('Method not allowed', 405, origin);
    if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);

    const body = await readJson(request);
    const action = String((body && body.action) || '').trim();

    if (action === 'challenge') {
      const publicKey = String((body && body.publicKey) || '').trim();
      if (!isSolanaPublicKey(publicKey)) return errorResponse('Invalid Solana public key', 400, origin);
      const nonce = randomBytes(18).toString('base64url');
      const issuedAt = new Date().toISOString();
      const message = challengeMessage(publicKey, nonce, issuedAt);
      await sql`
        INSERT INTO wallet_auth_challenges (profile_id, public_key, nonce, message, expires_at)
        VALUES (${profile.id}, ${publicKey}, ${nonce}, ${message}, NOW() + INTERVAL '10 minutes')
      `;
      return jsonResponse({ publicKey, nonce, message, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }, origin, 201);
    }

    if (action === 'connect') {
      const publicKey = String((body && body.publicKey) || '').trim();
      const message = String((body && body.message) || '');
      if (!isSolanaPublicKey(publicKey) || !message) return errorResponse('Invalid wallet login payload', 400, origin);
      const challenges = await sql`
        SELECT id
        FROM wallet_auth_challenges
        WHERE profile_id = ${profile.id}
          AND public_key = ${publicKey}
          AND message = ${message}
          AND consumed_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (!challenges.length) return errorResponse('Wallet challenge expired', 401, origin);
      if (!verifyWalletSignature(publicKey, message, body.signature)) {
        return errorResponse('Wallet signature verification failed', 401, origin);
      }
      await sql`
        UPDATE wallet_auth_challenges
        SET consumed_at = NOW()
        WHERE id = ${challenges[0].id}
      `;
      await sql`
        INSERT INTO wallet_accounts (profile_id, provider, public_key, verified_at)
        VALUES (${profile.id}, 'phantom', ${publicKey}, NOW())
        ON CONFLICT (profile_id, provider) DO UPDATE
          SET public_key = EXCLUDED.public_key,
              verified_at = NOW(),
              updated_at = NOW()
      `;
      return jsonResponse(await walletPayload(sql, profile), origin, 201);
    }

    if (action === 'disconnect') {
      await sql`
        DELETE FROM wallet_accounts
        WHERE profile_id = ${profile.id} AND provider = 'phantom'
      `;
      return jsonResponse({ wallet: null, token: { configured: !!solanaEnv('TINYWORLD_TOKEN_MINT', ''), uiAmount: '0' }, activity: [] }, origin);
    }

    if (action === 'refresh') {
      return jsonResponse(await walletPayload(sql, profile), origin);
    }

    return errorResponse('Unknown wallet action', 400, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    if (isMissingWalletSchema(err)) {
      return errorResponse('Wallet database tables are missing. Run the Netlify database migrations for wallet/social features.', 503, origin);
    }
    console.error('[wallet]', err);
    return errorResponse('Wallet request failed', 500, origin);
  }
}
