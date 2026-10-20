const { getDatabase } = require('../db');

const SettingsRepo = {
  get(key, defaultValue = null) {
    const db = getDatabase();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  },

  getInt(key, defaultValue = 0) {
    const val = this.get(key);
    return val !== null ? parseInt(val, 10) : defaultValue;
  },

  set(key, value) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  },

  delete(key) {
    const db = getDatabase();
    return db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  },

  getAll() {
    const db = getDatabase();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const result = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }
};

module.exports = SettingsRepo;
