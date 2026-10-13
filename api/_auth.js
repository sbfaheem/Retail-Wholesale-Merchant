const crypto = require('crypto');

// Default Admin credentials (can be overridden via environment variables)
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';
const JWT_SECRET = process.env.ADMIN_SECRET || 'roznamcha_super_secret_jwt_key_2026';

function verifySessionToken(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function createSessionToken(username) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    username,
    role: 'administrator',
    exp: Date.now() + (12 * 60 * 60 * 1000) // 12 hours valid
  };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  return `${headerB64}.${payloadB64}.${sig}`;
}

module.exports = {
  verifySessionToken,
  createSessionToken,
  ADMIN_USER,
  ADMIN_PASS,
  JWT_SECRET
};
