// Admin session authentication, role-based control, and settings API
const { getRoznamchaState, saveRoznamchaState, createDatabaseBackup, listDatabaseBackups, restoreDatabaseBackup, hasPostgres } = require('./_db');
const { verifySessionToken, createSessionToken, verifyCredentials, hashPassword, SUPERADMIN_USER, ADMIN_USER } = require('./_auth');

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
    // 1. POST /api/admin
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const action = body.action || req.query?.action;

      if (action === 'login') {
        const { username, password } = body;
        const state = await getRoznamchaState();
        const user = verifyCredentials(username, password, state.authCredentials || {});

        if (user) {
          const newToken = createSessionToken(user.username, user.role);
          return res.status(200).json({
            success: true,
            token: newToken,
            user: { username: user.username, role: user.role },
            expiresIn: 12 * 3600
          });
        }
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }

      if (action === 'verify') {
        if (session) {
          return res.status(200).json({
            success: true,
            valid: true,
            user: { username: session.username, role: session.role }
          });
        }
        return res.status(401).json({ success: false, valid: false, error: 'Session expired' });
      }

      // Protected Admin actions require valid session
      if (!session) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Admin authentication required' });
      }

      // Change Password (Strictly Super Admin only)
      if (action === 'change_password') {
        if (session.role !== 'superadmin') {
          return res.status(403).json({
            success: false,
            error: 'Access Denied: Only Super Admin has authority to change passwords.'
          });
        }

        const { targetUser, currentPassword, newPassword } = body;
        if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
          return res.status(400).json({
            success: false,
            error: 'New password must be at least 6 characters long.'
          });
        }

        const state = await getRoznamchaState();
        if (!state.authCredentials) state.authCredentials = {};

        const normalizedTarget = (targetUser || 'superadmin').toLowerCase();

        if (normalizedTarget === 'superadmin') {
          const checkCurrent = verifyCredentials(session.username, currentPassword, state.authCredentials);
          if (!checkCurrent || checkCurrent.role !== 'superadmin') {
            return res.status(400).json({
              success: false,
              error: 'Current Super Admin password is incorrect.'
            });
          }
          state.authCredentials.superadminPasswordHash = hashPassword(newPassword.trim());
          delete state.authCredentials.superadminPassword;
        } else if (normalizedTarget === 'admin') {
          state.authCredentials.adminPasswordHash = hashPassword(newPassword.trim());
          delete state.authCredentials.adminPassword;
        } else {
          return res.status(400).json({
            success: false,
            error: 'Invalid target user: must be superadmin or admin.'
          });
        }

        await saveRoznamchaState(state);
        return res.status(200).json({
          success: true,
          message: `Password for ${normalizedTarget === 'superadmin' ? 'Super Admin' : 'Admin'} updated successfully.`
        });
      }

      // Save KPI Overrides (Permitted for Admin and Super Admin)
      if (action === 'save_kpi_overrides') {
        const state = await getRoznamchaState();
        state.kpiOverrides = body.overrides || {};
        await saveRoznamchaState(state);
        return res.status(200).json({ success: true, kpiOverrides: state.kpiOverrides });
      }

      // Save Settings / Dynamic CMS (Permitted for Admin and Super Admin)
      if (action === 'save_settings') {
        const state = await getRoznamchaState();
        state.systemSettings = body.settings || {};
        await saveRoznamchaState(state);
        return res.status(200).json({ success: true, settings: state.systemSettings });
      }

      // Factory Reset (STRICTLY SUPER ADMIN ONLY)
      if (action === 'factory_reset') {
        if (session.role !== 'superadmin') {
          return res.status(403).json({
            success: false,
            error: 'Access Denied: Reset to Factory Defaults is restricted to Super Admin only.'
          });
        }

        const state = await getRoznamchaState();
        await saveRoznamchaState({
          records: {},
          customerAccounts: {},
          kpiOverrides: {},
          systemSettings: state.systemSettings || {},
          authCredentials: state.authCredentials || {}
        });
        return res.status(200).json({
          success: true,
          message: 'All ledger data reset to factory defaults.'
        });
      }

      return res.status(400).json({ success: false, error: 'Unknown action' });
    }

    // 2. GET /api/admin
    if (req.method === 'GET') {
      const action = req.query?.action;

      if (action === 'verify') {
        if (session) {
          return res.status(200).json({
            success: true,
            valid: true,
            user: { username: session.username, role: session.role }
          });
        }
        return res.status(401).json({ success: false, valid: false, error: 'Session expired' });
      }

      const state = await getRoznamchaState();
      return res.status(200).json({
        success: true,
        authenticated: !!session,
        user: session ? { username: session.username, role: session.role } : null,
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
