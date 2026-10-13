const crypto = require('crypto');

// Default Admin & Super Admin credentials (can be overridden via environment variables or DB state)
const SUPERADMIN_USER = process.env.SUPERADMIN_USERNAME || 'superadmin';
const SUPERADMIN_PASS = process.env.SUPERADMIN_PASSWORD || 'superadmin123';

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

const JWT_SECRET = process.env.ADMIN_SECRET || 'roznamcha_super_secret_jwt_key_2026';

function hashPassword(password) {
  if (!password) return '';
  return crypto.createHash('sha256').update(password + ':' + JWT_SECRET).digest('hex');
}

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

function createSessionToken(username, role = 'admin') {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    username,
    role: role === 'superadmin' ? 'superadmin' : 'admin',
    exp: Date.now() + (12 * 60 * 60 * 1000) // 12 hours valid
  };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
  return `${headerB64}.${payloadB64}.${sig}`;
}

function verifyCredentials(username, password, authCredentials = {}) {
  if (!username || !password) return null;

  const targetUser = username.trim().toLowerCase();

  // 1. Check Super Admin
  const superUser = (authCredentials.superadminUser || SUPERADMIN_USER).toLowerCase();
  if (targetUser === superUser) {
    if (authCredentials.superadminPasswordHash) {
      if (hashPassword(password) === authCredentials.superadminPasswordHash) {
        return { username: 'superadmin', role: 'superadmin' };
      }
    } else if (password === (authCredentials.superadminPassword || SUPERADMIN_PASS)) {
      return { username: 'superadmin', role: 'superadmin' };
    }
  }

  // 2. Check Standard Admin
  const adminUser = (authCredentials.adminUser || ADMIN_USER).toLowerCase();
  if (targetUser === adminUser) {
    if (authCredentials.adminPasswordHash) {
      if (hashPassword(password) === authCredentials.adminPasswordHash) {
        return { username: 'admin', role: 'admin' };
      }
    } else if (password === (authCredentials.adminPassword || ADMIN_PASS)) {
      return { username: 'admin', role: 'admin' };
    }
  }

  return null;
}

module.exports = {
  verifySessionToken,
  createSessionToken,
  verifyCredentials,
  hashPassword,
  SUPERADMIN_USER,
  SUPERADMIN_PASS,
  ADMIN_USER,
  ADMIN_PASS,
  JWT_SECRET
};
