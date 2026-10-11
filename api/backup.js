// Vercel Serverless Function & Nightly 1AM Cron: /api/backup
const { createDatabaseBackup, listDatabaseBackups, restoreDatabaseBackup, hasPostgres } = require('./_db');

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. GET: List past backups (or trigger 1AM cron if query ?auto=true or called by Vercel cron)
    if (req.method === 'GET') {
      const isAutoCron = req.query && (req.query.auto === 'true' || req.query.cron === 'true');
      
      if (isAutoCron) {
        // Nightly 1:00 AM Cron Trigger
        const backupResult = await createDatabaseBackup('auto_1am');
        return res.status(200).json({
          success: true,
          message: 'Nightly 1:00 AM database backup executed successfully',
          cronSchedule: '0 20 * * * (1:00 AM Pakistan Time PKT)',
          backup: backupResult
        });
      }

      // Return list of available backups
      const backups = await listDatabaseBackups();
      return res.status(200).json({
        success: true,
        isDatabaseConnected: hasPostgres(),
        cronSchedule: 'Every night at 1:00 AM PKT (20:00 UTC)',
        backups: backups
      });
    }

    // 2. POST: Manual backup creation or Restore execution
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const action = body ? body.action : 'backup';

      if (action === 'restore') {
        const backupKey = body.backupKey;
        const directPayload = body.payload;
        const restoredData = await restoreDatabaseBackup(backupKey, directPayload);
        return res.status(200).json({
          success: true,
          message: `Database restored successfully from backup ${backupKey || 'uploaded snapshot'}`,
          data: restoredData
        });
      }

      // Manual backup trigger
      const backupResult = await createDatabaseBackup('manual');
      return res.status(200).json({
        success: true,
        message: 'Manual database snapshot backup created successfully',
        backup: backupResult
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Error handling /api/backup:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error during database backup'
    });
  }
};
