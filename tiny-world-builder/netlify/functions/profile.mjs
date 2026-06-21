import { requireAuthUser } from './lib/auth.mjs';
import { getSql, isDatabaseUnavailable } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile, normalizeUsername, profileDto } from './lib/profiles.mjs';

export const config = { path: '/api/profile' };

function validateProfile(body) {
  const username = normalizeUsername(body && body.username);
  const displayName = String((body && body.displayName) || '').trim().slice(0, 80);
  const about = String((body && body.about) || '').trim().slice(0, 1000);
  const image = String((body && body.image) || '').trim().slice(0, 2048);
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return { error: 'Username must be 3-24 lowercase letters, numbers, underscores' };
  if (!displayName) return { error: 'Display name required' };
  return { username, displayName, about, image };
}

export default async function profileFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;
  const user = auth.user;

  try {
    if (request.method === 'GET') {
      const profile = await ensureProfile(user);
      return jsonResponse(profileDto(profile), origin);
    }

    if (request.method === 'PUT') {
      if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
      const body = await readJson(request);
      const input = validateProfile(body);
      if (input.error) return errorResponse(input.error, 400, origin);

      await ensureProfile(user);
      const sql = getSql();
      const rows = await sql`
        UPDATE profiles
        SET username = ${input.username},
            display_name = ${input.displayName},
            about = ${input.about},
            image = ${input.image},
            updated_at = NOW()
        WHERE auth0_id = ${user.id}
        RETURNING id, auth0_id, username, display_name, about, image, created_at, updated_at
      `;
      if (!rows.length) return errorResponse('Profile not found', 404, origin);
      return jsonResponse(profileDto(rows[0]), origin);
    }

    return errorResponse('Method not allowed', 405, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    if (err && err.code === '23505') return errorResponse('Username is already taken', 409, origin);
    console.error('[profile]', err);
    return errorResponse('Profile request failed', 500, origin);
  }
}
