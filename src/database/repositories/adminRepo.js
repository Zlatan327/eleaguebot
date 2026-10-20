const { getDatabase } = require('../db');
const SettingsRepo = require('./settingsRepo');

function normalizeId(id) {
  if (!id) return '';
  let digits = id.replace(/[^0-9]/g, '');
  // Normalize 11-digit national Nigerian numbers (e.g. 08012345678 -> 2348012345678)
  if (digits.startsWith('0') && digits.length === 11) {
    digits = '234' + digits.slice(1);
  }
  return digits;
}

const AdminRepo = {
  isAdmin(senderId) {
    if (!senderId) return false;
    const db = getDatabase();

    const norm = normalizeId(senderId);

    // 1. Check database admins table
    const row = db.prepare(`
      SELECT whatsapp_id FROM admins 
      WHERE whatsapp_id = ? 
         OR REPLACE(REPLACE(whatsapp_id, '@c.us', ''), '@s.whatsapp.net', '') = ?
    `).get(senderId, norm);

    if (row) return true;

    // 2. Check if sender matches INITIAL_ADMIN_PHONE from config/env
    const initialAdmin = process.env.INITIAL_ADMIN_PHONE ? normalizeId(process.env.INITIAL_ADMIN_PHONE) : '';
    if (initialAdmin && norm === initialAdmin) {
      // Auto-register into database
      this.addAdmin(senderId, 'Initial Admin');
      return true;
    }

    return false;
  },

  /**
   * Secure admin claiming using setup token
   */
  claimAdmin(senderId, token, name = 'Admin') {
    if (!senderId || !token) return false;
    const configuredToken = SettingsRepo.get('admin_setup_token') || process.env.ADMIN_SETUP_TOKEN;
    
    // If no token configured and no admins exist, disallow unauthenticated claim
    if (!configuredToken) {
      throw new Error('Admin setup token has not been configured in .env. Please set INITIAL_ADMIN_PHONE or ADMIN_SETUP_TOKEN.');
    }

    if (token.trim() !== configuredToken.trim()) {
      throw new Error('Invalid setup token.');
    }

    this.addAdmin(senderId, name);
    return true;
  },

  addAdmin(whatsappId, name = '') {
    const db = getDatabase();
    return db.prepare(`
      INSERT INTO admins (whatsapp_id, name)
      VALUES (?, ?)
      ON CONFLICT(whatsapp_id) DO UPDATE SET name = excluded.name
    `).run(whatsappId, name);
  },

  removeAdmin(whatsappId) {
    const db = getDatabase();
    const norm = normalizeId(whatsappId);
    return db.prepare(`
      DELETE FROM admins 
      WHERE whatsapp_id = ? 
         OR REPLACE(REPLACE(whatsapp_id, '@c.us', ''), '@s.whatsapp.net', '') = ?
    `).run(whatsappId, norm);
  },

  countAdmins() {
    const db = getDatabase();
    return db.prepare('SELECT COUNT(*) as count FROM admins').get().count;
  },

  getAll() {
    const db = getDatabase();
    return db.prepare('SELECT whatsapp_id, name, created_at FROM admins ORDER BY created_at ASC').all();
  }
};

module.exports = AdminRepo;
