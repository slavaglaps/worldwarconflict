import { getSql } from './db.mjs';

function cleanText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function profileSuffix(userId) {
  return String(userId || 'user').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'user';
}

export function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
}

function defaultUsernameForUser(user) {
  const metadata = user.userMetadata || {};
  const raw = normalizeUsername(metadata.username || metadata.display_name || metadata.full_name || metadata.name || user.email);
  const suffix = profileSuffix(user.id);
  const base = raw.length >= 3 ? raw.slice(0, 15) : 'builder';
  return (base + '_' + suffix).slice(0, 24);
}

function defaultDisplayNameForUser(user) {
  const metadata = user.userMetadata || {};
  return cleanText(
    metadata.display_name || metadata.full_name || metadata.name || user.name || user.email || 'TinyWorld Builder',
    80,
  ) || 'TinyWorld Builder';
}

function defaultImageForUser(user) {
  const metadata = user.userMetadata || {};
  return cleanText(user.pictureUrl || metadata.avatar_url || metadata.picture || metadata.image, 2048);
}

export function profileDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    auth0Id: row.auth0_id,
    username: row.username,
    displayName: row.display_name,
    about: row.about || '',
    image: row.image || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureProfile(user) {
  const sql = getSql();
  const existing = await sql`
    SELECT id, auth0_id, username, display_name, about, image, created_at, updated_at
    FROM profiles
    WHERE auth0_id = ${user.id}
    LIMIT 1
  `;
  if (existing.length) return existing[0];

  const username = defaultUsernameForUser(user);
  const displayName = defaultDisplayNameForUser(user);
  const image = defaultImageForUser(user);
  try {
    const inserted = await sql`
      INSERT INTO profiles (auth0_id, username, display_name, about, image)
      VALUES (${user.id}, ${username}, ${displayName}, '', ${image})
      ON CONFLICT (auth0_id) DO NOTHING
      RETURNING id, auth0_id, username, display_name, about, image, created_at, updated_at
    `;
    if (inserted.length) return inserted[0];
  } catch (err) {
    if (err && err.code !== '23505') throw err;
  }

  const fallbackUsername = ('builder_' + profileSuffix(user.id)).slice(0, 24);
  const fallback = await sql`
    INSERT INTO profiles (auth0_id, username, display_name, about, image)
    VALUES (${user.id}, ${fallbackUsername}, ${displayName}, '', ${image})
    ON CONFLICT (auth0_id) DO UPDATE SET updated_at = profiles.updated_at
    RETURNING id, auth0_id, username, display_name, about, image, created_at, updated_at
  `;
  return fallback[0];
}
