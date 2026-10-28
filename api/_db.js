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

// Default Multi-Branch configuration
const DEFAULT_BRANCHES = [
  {
    id: 'branch-khi-01',
    name: 'Gulshan Outlet',
    code: 'KHI-01',
    city: 'Karachi',
    address: 'Block 13-C, Main University Road, Gulshan-e-Iqbal',
    contact_number: '0300-1112233',
    manager_name: 'Aslam Khan',
    is_active: true,
    color_accent: 'emerald',
    created_at: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'branch-khi-02',
    name: 'Saddar Wholesale Counter',
    code: 'KHI-02',
    city: 'Karachi',
    address: 'Shop # 42, Cloth Market, Saddar',
    contact_number: '0300-4445566',
    manager_name: 'Tariq Mehmood',
    is_active: true,
    color_accent: 'sky',
    created_at: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'branch-lhr-01',
    name: 'Lahore Main Market',
    code: 'LHR-01',
    city: 'Lahore',
    address: 'Plot 18, Commercial Zone, Main Market, Gulberg',
    contact_number: '0300-7778899',
    manager_name: 'Bilal Faheem',
    is_active: true,
    color_accent: 'amber',
    created_at: '2026-01-01T00:00:00.000Z'
  }
];

// In-memory cache for fast response and fallback
let memoryCache = {
  branches: DEFAULT_BRANCHES,
  records: {},
  customerAccounts: [],
  branchTransfers: [],
  kpiOverrides: {},
  systemSettings: {},
  authCredentials: {},
  backups: [],
  lastUpdated: new Date().toISOString()
};

// Known legacy demo template signatures
const DEMO_SIGNATURE_NOTES = [
  'Saturday Counter Opened by Aslam',
  'Busy Sunday market counter',
  'Wholesale deliveries to city center',
  'Major vendor clearing day (Basit consignment clearance)',
  'Mid-week inventory replenishment',
  'Peak Thursday wholesale bulk billing',
  'Current active terminal session'
];

const DEMO_CUSTOMER_IDS = ['cust-1', 'cust-2', 'cust-3', 'cust-4', 'cust-5'];
const DEMO_CUSTOMER_NAMES = [
  'M/S Khan Cloth Store',
  'Rahim Garments',
  'Bismillah Boutique',
  'Master Tailors & Drapers',
  'Star Wholesale Fabrics'
];

// Purge any dummy demo records while strictly preserving genuine admin records & enforcing multi-branch scoping
function sanitizeState(state) {
  if (!state || typeof state !== 'object') return state;

  // 1. Ensure Branches Master entity exists
  if (!Array.isArray(state.branches) || state.branches.length === 0) {
    state.branches = DEFAULT_BRANCHES;
  } else {
    // Ensure all default branches are present or user-defined branches valid
    const existingIds = new Set(state.branches.map(b => b.id));
    DEFAULT_BRANCHES.forEach(defB => {
      if (!existingIds.has(defB.id)) {
        state.branches.push(defB);
      }
    });
  }

  // 2. Multi-Branch Record Sanitization & Scoping
  if (state.records && typeof state.records === 'object') {
    const cleanedRecords = {};
    const defaultBranchId = (state.branches && state.branches[0]) ? state.branches[0].id : 'branch-khi-01';

    for (const [key, rec] of Object.entries(state.records)) {
      if (!rec) continue;
      const isExplicitDemo = rec.isDemo === true || rec.isSample === true;
      const hasDemoNote = DEMO_SIGNATURE_NOTES.some(sig => (rec.notes || '').includes(sig));
      if (!isExplicitDemo && !hasDemoNote) {
        // Tag with branch_id if missing (assign unassigned to primary default branch)
        const branchId = rec.branchId || rec.branch_id || defaultBranchId;
        const date = rec.date || (key.includes('__') ? key.split('__')[1] : key);
        const compoundKey = `${branchId}__${date}`;

        rec.id = rec.id || compoundKey;
        rec.branchId = branchId;
        rec.date = date;

        cleanedRecords[compoundKey] = rec;
      }
    }
    state.records = cleanedRecords;
  }

  // 3. Customer Accounts & Udhaar Scoping
  if (Array.isArray(state.customerAccounts)) {
    state.customerAccounts = state.customerAccounts.filter(c => {
      if (!c) return false;
      const isDemoId = DEMO_CUSTOMER_IDS.includes(c.id);
      const isDemoName = DEMO_CUSTOMER_NAMES.some(n => (c.name || '').trim().toLowerCase() === n.toLowerCase());
      return !isDemoId && !isDemoName;
    }).map(c => {
      // Default customer account to centralized or branch-khi-01 if unspecified
      if (!c.branchId) c.branchId = 'all';
      return c;
    });
  }

  // 4. Inter-branch transfers array
  if (!Array.isArray(state.branchTransfers)) {
    state.branchTransfers = [];
  }

  return state;
}

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
        -- 1. Branches Master Table
        CREATE TABLE IF NOT EXISTS branches (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(150) NOT NULL,
          code VARCHAR(50) UNIQUE NOT NULL,
          city VARCHAR(100) NOT NULL,
          address TEXT,
          contact_number VARCHAR(50),
          manager_name VARCHAR(100),
          color_accent VARCHAR(30) DEFAULT 'emerald',
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        -- 2. Daily Ledgers with Compound Unique Constraint (branch_id, date)
        CREATE TABLE IF NOT EXISTS daily_ledgers (
          id SERIAL PRIMARY KEY,
          branch_id VARCHAR(50) REFERENCES branches(id) ON DELETE CASCADE,
          date VARCHAR(20) NOT NULL,
          data JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT uq_branch_date UNIQUE (branch_id, date)
        );

        CREATE INDEX IF NOT EXISTS idx_daily_ledgers_branch_date ON daily_ledgers (branch_id, date);

        -- 3. Inter-Branch Cash Transfers
        CREATE TABLE IF NOT EXISTS branch_transfers (
          id VARCHAR(50) PRIMARY KEY,
          from_branch_id VARCHAR(50) REFERENCES branches(id),
          to_branch_id VARCHAR(50) REFERENCES branches(id),
          amount NUMERIC(15, 2) NOT NULL,
          transfer_date VARCHAR(20) NOT NULL,
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        -- 4. Global State Snapshot & Document Store
        CREATE TABLE IF NOT EXISTS roznamcha_state (
          id VARCHAR(50) PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        -- 5. Backups Table
        CREATE TABLE IF NOT EXISTS roznamcha_backups (
          id SERIAL PRIMARY KEY,
          backup_key VARCHAR(100) NOT NULL,
          backup_type VARCHAR(20) DEFAULT 'auto_1am',
          record_count INT DEFAULT 0,
          payload JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Seed default branches if empty
      const brCheck = await client.query('SELECT COUNT(*) FROM branches');
      if (parseInt(brCheck.rows[0].count, 10) === 0) {
        for (const b of DEFAULT_BRANCHES) {
          await client.query(`
            INSERT INTO branches (id, name, code, city, address, contact_number, manager_name, color_accent, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO NOTHING
          `, [b.id, b.name, b.code, b.city, b.address, b.contact_number, b.manager_name, b.color_accent, b.is_active]);
        }
      }
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
        return sanitizeState(res.rows[0].data);
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
      return sanitizeState(JSON.parse(content));
    }
  } catch (e) {
    // Return memory cache
  }

  return sanitizeState(memoryCache);
}

async function saveRoznamchaState(data) {
  const currentState = await getRoznamchaState().catch(() => ({}));
  const payload = sanitizeState({
    branches: data.branches !== undefined ? data.branches : (currentState.branches || DEFAULT_BRANCHES),
    branchTransfers: data.branchTransfers !== undefined ? data.branchTransfers : (currentState.branchTransfers || []),
    records: data.records !== undefined ? data.records : (currentState.records || {}),
    kpiOverrides: data.kpiOverrides !== undefined ? data.kpiOverrides : (currentState.kpiOverrides || {}),
    customerAccounts: data.customerAccounts !== undefined ? data.customerAccounts : (currentState.customerAccounts || {}),
    systemSettings: data.systemSettings !== undefined ? data.systemSettings : (currentState.systemSettings || {}),
    authCredentials: data.authCredentials !== undefined ? data.authCredentials : (currentState.authCredentials || memoryCache.authCredentials || {}),
    lastUpdated: new Date().toISOString()
  });

  memoryCache = { ...memoryCache, ...payload };

  if (pgPool) {
    try {
      await pgPool.query(`
        INSERT INTO roznamcha_state (id, data, updated_at)
        VALUES ('main_store', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = CURRENT_TIMESTAMP
      `, [payload]);

      // Sync individual daily_ledgers table for relational querying
      if (payload.records && typeof payload.records === 'object') {
        for (const rec of Object.values(payload.records)) {
          if (rec && rec.branchId && rec.date) {
            await pgPool.query(`
              INSERT INTO daily_ledgers (branch_id, date, data, created_at)
              VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
              ON CONFLICT (branch_id, date) DO UPDATE SET data = $3, created_at = CURRENT_TIMESTAMP
            `, [rec.branchId, rec.date, rec]).catch(() => {});
          }
        }
      }

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
