// Admin session authentication and settings API
const { getRoznamchaState, saveRoznamchaState, createDatabaseBackup, listDatabaseBackups, restoreDatabaseBackup, hasPostgres } = require('./_db');
const { verifySessionToken, createSessionToken, ADMIN_USER, ADMIN_PASS } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query?.token || '');
  const session = verifySessionToken(token);

  try {
    // 1. POST /api/admin?action=login
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const action = body.action || req.query?.action;

      if (action === 'login') {
        const { username, password } = body;
        if (username === ADMIN_USER && password === ADMIN_PASS) {
          const newToken = createSessionToken(username);
          return res.status(200).json({
            success: true,
            token: newToken,
            user: { username, role: 'administrator' },
            expiresIn: 12 * 3600
          });
        }
        return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
      }

      if (action === 'verify') {
        if (session) {
          return res.status(200).json({ success: true, valid: true, user: session });
        }
        return res.status(401).json({ success: false, valid: false, error: 'Session expired' });
      }

      // Protected Admin actions require valid session
      if (!session) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Admin authentication required' });
      }

      // Admin Save Settings
      if (action === 'save_kpi_overrides') {
        const state = await getRoznamchaState();
        state.kpiOverrides = body.overrides || {};
        await saveRoznamchaState(state);
        return res.status(200).json({ success: true, kpiOverrides: state.kpiOverrides });
      }

      if (action === 'save_settings') {
        const state = await getRoznamchaState();
        state.systemSettings = body.settings || {};
        await saveRoznamchaState(state);
        return res.status(200).json({ success: true, settings: state.systemSettings });
      }

      // Admin Factory Reset
      if (action === 'factory_reset') {
        await saveRoznamchaState({ records: {}, customerAccounts: {}, systemSettings: {} });
        return res.status(200).json({ success: true, message: 'All ledger data reset to factory defaults' });
      }

      return res.status(400).json({ success: false, error: 'Unknown action' });
    }

    // 2. GET /api/admin
    if (req.method === 'GET') {
      const action = req.query?.action;

      if (action === 'verify') {
        if (session) {
          return res.status(200).json({ success: true, valid: true, user: session });
        }
        return res.status(401).json({ success: false, valid: false, error: 'Session expired' });
      }

      // Return public settings or full state if authenticated
      const state = await getRoznamchaState();
      return res.status(200).json({
        success: true,
        authenticated: !!session,
        settings: state.systemSettings || null,
        kpiOverrides: state.kpiOverrides || {}
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Server error' });
  }
};
