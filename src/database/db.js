const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config');

let dbInstance = null;

function runMigrations(db) {
  // Gracefully add baseline columns to players if upgrading existing DB
  const playerColumns = [
    'baseline_played INTEGER DEFAULT 0',
    'baseline_won INTEGER DEFAULT 0',
    'baseline_drawn INTEGER DEFAULT 0',
    'baseline_lost INTEGER DEFAULT 0',
    'baseline_gf INTEGER DEFAULT 0',
    'baseline_ga INTEGER DEFAULT 0',
    'baseline_points INTEGER DEFAULT 0',
  ];

  for (const col of playerColumns) {
    try {
      db.exec(`ALTER TABLE players ADD COLUMN ${col}`);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  try {
    db.exec('ALTER TABLE fixtures ADD COLUMN is_backfill INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists, ignore
  }
}

function initDatabase(customPath = null) {
  const dbFile = customPath || config.dbPath;

  // Ensure directory exists if not in-memory
  if (dbFile !== ':memory:') {
    const dir = path.dirname(dbFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  // Run migrations for upgrades
  runMigrations(db);

  // Initialize default settings if not present
  const defaultSettings = [
    ['deadline_days', String(config.defaultDeadlineDays)],
    ['points_win', String(config.defaultPointsWin)],
    ['points_draw', String(config.defaultPointsDraw)],
    ['points_loss', String(config.defaultPointsLoss)],
    ['current_week', '1'],
    ['league_status', 'not_started'],
    ['submission_policy', config.submissionPolicy],
    ['league_group_id', config.leagueGroupId],
    ['admin_setup_token', config.adminSetupToken],
  ];

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const setMany = db.transaction((settings) => {
    for (const [k, v] of settings) {
      insertSetting.run(k, v);
    }
  });
  setMany(defaultSettings);

  // Add initial admin if configured
  if (config.initialAdminPhone) {
    let clean = config.initialAdminPhone.replace(/[^0-9]/g, '');
    if (clean) {
      if (clean.startsWith('0') && clean.length === 11) {
        clean = '234' + clean.slice(1);
      }
      const adminJid = clean.includes('@') ? clean : `${clean}@c.us`;
      db.prepare('INSERT OR IGNORE INTO admins (whatsapp_id, name) VALUES (?, ?)').run(adminJid, 'SuperAdmin');
      // Also register raw form
      const rawJid = `${config.initialAdminPhone.replace(/[^0-9]/g, '')}@c.us`;
      db.prepare('INSERT OR IGNORE INTO admins (whatsapp_id, name) VALUES (?, ?)').run(rawJid, 'SuperAdmin');
    }
  }

  dbInstance = db;
  return db;
}

function getDatabase() {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

module.exports = {
  initDatabase,
  getDatabase,
};
