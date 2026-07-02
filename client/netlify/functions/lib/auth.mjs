import { getUser } from '@netlify/identity';
import { errorResponse } from './http.mjs';

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function userFromIdentityPayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.id) return null;
  const userMetadata = payload.user_metadata || payload.userMetadata || {};
  const appMetadata = payload.app_metadata || payload.appMetadata || {};
  return {
    id: payload.id,
    email: payload.email,
    name: userMetadata.full_name || userMetadata.name || payload.email,
    pictureUrl: userMetadata.avatar_url || userMetadata.picture,
    userMetadata,
    appMetadata,
  };
}

async function userFromBearerToken(request) {
  const token = bearerToken(request);
  if (!token) return null;
  // Resolve the identity verify host from trusted deploy config rather than the
  // incoming request URL so the validation target can never come from request
  // data. Fail closed when the site URL is unset.
  const identityBase = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!identityBase) return null;
  try {
    const identityUrl = new URL('/.netlify/identity/user', identityBase);
    const res = await fetch(identityUrl, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return null;
    return userFromIdentityPayload(await res.json());
  } catch (_) {
    return null;
  }
}

export async function getAuthUser(request) {
  try {
    const user = await getUser();
    if (user && user.id) return user;
  } catch (_) {}
  return userFromBearerToken(request);
}

export async function requireAuthUser(request, origin) {
  const user = await getAuthUser(request);
  if (!user || !user.id) return { response: errorResponse('Unauthorized', 401, origin) };
  return { user };
}
