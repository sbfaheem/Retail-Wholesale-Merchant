// Database client and adapter (Postgres / SQLite / In-Memory / File-based)
const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DB_FILE || path.join(process.cwd(), '.data', 'roznamcha.json');

// Ensure local storage directory exists if using file storage
function ensureDataDir() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      // In read-only serverless environments without writable cwd, fallback to /tmp
    }
  }
}

// In-memory cache for fast response and fallback
let memoryCache = {
  records: {},
  customerAccounts: {},
  kpiOverrides: {},
  backups: [],
  lastUpdated: new Date().toISOString()
};

// Check if PostgreSQL (Vercel Postgres, Neon, Supabase, Railway) is configured
const hasPostgres = !!(process.env.POSTGRES_URL || process.env.DATABASE_URL);

let pgPool = null;
if (hasPostgres) {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
    });
  } catch (e) {
    console.warn('Postgres module not loaded or pool init skipped:', e.message);
  }
}

async function initPostgresTables() {
  if (!pgPool) return;
  try {
    const client = await pgPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS roznamcha_state (
          id VARCHAR(50) PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS roznamcha_backups (
          id SERIAL PRIMARY KEY,
          backup_key VARCHAR(100) NOT NULL,
          backup_type VARCHAR(20) DEFAULT 'auto_1am',
          record_count INT DEFAULT 0,
          payload JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to initialize Postgres schema:', err.message);
  }
}

// Initialize tables once on cold start if PG is available
if (hasPostgres) {
  initPostgresTables().catch(err => console.error(err));
}

async function getRoznamchaState() {
  if (pgPool) {
    try {
      const res = await pgPool.query('SELECT data FROM roznamcha_state WHERE id = $1', ['main_store']);
      if (res.rows.length > 0 && res.rows[0].data) {
        return res.rows[0].data;
      }
    } catch (err) {
      console.warn('Postgres query failed, falling back to local file/memory:', err.message);
    }
  }

  // File-based fallback
  try {
    const filePath = fs.existsSync(DB_FILE) ? DB_FILE : (fs.existsSync('/tmp/roznamcha.json') ? '/tmp/roznamcha.json' : null);
    if (filePath) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    // Return memory cache
  }

  return memoryCache;
}

async function saveRoznamchaState(data) {
  const payload = {
    records: data.records || {},
    kpiOverrides: data.kpiOverrides || {},
    customerAccounts: data.customerAccounts || {},
    lastUpdated: new Date().toISOString()
  };

  memoryCache = { ...memoryCache, ...payload };

  if (pgPool) {
    try {
      await pgPool.query(`
        INSERT INTO roznamcha_state (id, data, updated_at)
        VALUES ('main_store', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = CURRENT_TIMESTAMP
      `, [payload]);
      return payload;
    } catch (err) {
      console.warn('Postgres save failed, falling back to file/memory:', err.message);
    }
  }

  // Local file save
  try {
    ensureDataDir();
    const targetFile = fs.existsSync(path.dirname(DB_FILE)) ? DB_FILE : '/tmp/roznamcha.json';
    fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    // Memory cache already updated
  }

  return payload;
}

async function createDatabaseBackup(backupType = 'auto_1am') {
  const currentState = await getRoznamchaState();
  const dateStr = new Date().toISOString();
  const backupKey = `backup_${dateStr.replace(/[:.]/g, '-')}_${backupType}`;
  const recordCount = Object.keys(currentState.records || {}).length;

  const backupMeta = {
    backupKey,
    backupType,
    recordCount,
    createdAt: dateStr,
    sizeBytes: JSON.stringify(currentState).length
  };

  if (pgPool) {
    try {
      await pgPool.query(`
        INSERT INTO roznamcha_backups (backup_key, backup_type, record_count, payload, created_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      `, [backupKey, backupType, recordCount, currentState]);
    } catch (err) {
      console.error('Postgres backup insertion failed:', err.message);
    }
  }

  // Save to file if available
  try {
    const backupDir = path.join(process.cwd(), '.data', 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, `${backupKey}.json`), JSON.stringify(currentState, null, 2), 'utf8');
  } catch (e) {
    // /tmp fallback
    try {
      if (!fs.existsSync('/tmp/backups')) fs.mkdirSync('/tmp/backups', { recursive: true });
      fs.writeFileSync(`/tmp/backups/${backupKey}.json`, JSON.stringify(currentState, null, 2), 'utf8');
    } catch (errTmp) {}
  }

  if (!memoryCache.backups) memoryCache.backups = [];
  memoryCache.backups.unshift(backupMeta);
  if (memoryCache.backups.length > 30) memoryCache.backups.pop(); // Keep last 30 backups

  return {
    success: true,
    backupKey,
    backupType,
    recordCount,
    timestamp: dateStr,
    payload: currentState
  };
}

async function listDatabaseBackups() {
  if (pgPool) {
    try {
      const res = await pgPool.query(`
        SELECT id, backup_key, backup_type, record_count, created_at,
               pg_column_size(payload) as size_bytes
        FROM roznamcha_backups
        ORDER BY created_at DESC
        LIMIT 30
      `);
      return res.rows.map(r => ({
        id: r.id,
        backupKey: r.backup_key,
        backupType: r.backup_type,
        recordCount: r.record_count,
        createdAt: r.created_at,
        sizeBytes: parseInt(r.size_bytes, 10) || 0
      }));
    } catch (err) {
      console.warn('Postgres backup listing failed:', err.message);
    }
  }

  // Local backups check
  const backupsList = [...(memoryCache.backups || [])];
  try {
    const backupDir = fs.existsSync(path.join(process.cwd(), '.data', 'backups'))
      ? path.join(process.cwd(), '.data', 'backups')
      : (fs.existsSync('/tmp/backups') ? '/tmp/backups' : null);
    
    if (backupDir) {
      const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.json'));
      files.forEach(f => {
        const key = f.replace('.json', '');
        if (!backupsList.some(b => b.backupKey === key)) {
          const stats = fs.statSync(path.join(backupDir, f));
          backupsList.push({
            backupKey: key,
            backupType: key.includes('auto') ? 'auto_1am' : 'manual',
            createdAt: stats.mtime.toISOString(),
            sizeBytes: stats.size
          });
        }
      });
    }
  } catch (e) {}

  return backupsList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function restoreDatabaseBackup(backupKey, directPayload = null) {
  let restoreData = directPayload;

  if (!restoreData && pgPool) {
    try {
      const res = await pgPool.query('SELECT payload FROM roznamcha_backups WHERE backup_key = $1', [backupKey]);
      if (res.rows.length > 0) {
        restoreData = res.rows[0].payload;
      }
    } catch (err) {
      console.warn('Postgres backup fetch failed:', err.message);
    }
  }

  if (!restoreData) {
    try {
      const localPaths = [
        path.join(process.cwd(), '.data', 'backups', `${backupKey}.json`),
        `/tmp/backups/${backupKey}.json`
      ];
      for (const p of localPaths) {
        if (fs.existsSync(p)) {
          restoreData = JSON.parse(fs.readFileSync(p, 'utf8'));
          break;
        }
      }
    } catch (e) {}
  }

  if (!restoreData) {
    throw new Error(`Backup '${backupKey}' not found.`);
  }

  return await saveRoznamchaState(restoreData);
}

module.exports = {
  getRoznamchaState,
  saveRoznamchaState,
  createDatabaseBackup,
  listDatabaseBackups,
  restoreDatabaseBackup,
  hasPostgres: () => !!pgPool
};
