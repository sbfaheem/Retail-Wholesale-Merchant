// Vercel Serverless Function: /api/records
const { getRoznamchaState, saveRoznamchaState, hasPostgres } = require('./_db');

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const state = await getRoznamchaState();
      return res.status(200).json({
        success: true,
        isDatabaseConnected: hasPostgres(),
        databaseType: hasPostgres() ? 'PostgreSQL' : 'Local/Serverless Fallback',
        data: state
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body) {
        return res.status(400).json({ error: 'Missing request payload' });
      }

      const savedState = await saveRoznamchaState(body);
      return res.status(200).json({
        success: true,
        message: 'Roznamcha records saved to database successfully',
        data: savedState
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Error handling /api/records:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error'
    });
  }
};
