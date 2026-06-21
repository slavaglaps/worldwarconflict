// Авторизация без внешних зависимостей: scrypt для паролей, HS256-JWT на Node crypto.
// Для прод-усиления — RS256/argon2, но HS256+scrypt вполне боевой вариант.
const crypto = require('crypto');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
if (process.env.NODE_ENV === 'production' && SECRET === 'dev-secret-change-in-prod') {
  throw new Error('JWT_SECRET must be set in production');
}
const b64 = (s) => Buffer.from(s).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function verifyPassword(pw, stored) {
  try {
    const [saltHex, dkHex] = String(stored).split(':');
    const dk = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
    return crypto.timingSafeEqual(dk, Buffer.from(dkHex, 'hex'));
  } catch { return false; }
}
function signToken(payload, ttlSec = 7 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  const sig = crypto.createHmac('sha256', SECRET).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}
function verifyToken(token) {
  try {
    const [h, b, sig] = String(token).split('.');
    const expect = crypto.createHmac('sha256', SECRET).update(h + '.' + b).digest('base64url');
    const a = Buffer.from(sig), e = Buffer.from(expect);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
    const body = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch { return null; }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
