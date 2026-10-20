require('dotenv').config();
const path = require('path');

const config = {
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'eleague.db'),
  sessionDir: process.env.SESSION_DIR || path.join(__dirname, '..', '.wwebjs_auth'),
  defaultDeadlineDays: parseInt(process.env.DEFAULT_DEADLINE_DAYS || '3', 10),
  defaultPointsWin: parseInt(process.env.DEFAULT_POINTS_WIN || '3', 10),
  defaultPointsDraw: parseInt(process.env.DEFAULT_POINTS_DRAW || '1', 10),
  defaultPointsLoss: parseInt(process.env.DEFAULT_POINTS_LOSS || '0', 10),
  initialAdminPhone: process.env.INITIAL_ADMIN_PHONE || '', // e.g. "1234567890"
  adminSetupToken: process.env.ADMIN_SETUP_TOKEN || '', // Secret token to claim admin
  leagueGroupId: process.env.LEAGUE_GROUP_ID || '', // Lock to specific group if set
  submissionPolicy: process.env.SUBMISSION_POLICY || 'players_or_admin', // 'admin_only' or 'players_or_admin'
  rateLimitSeconds: parseInt(process.env.RATE_LIMIT_SECONDS || '2', 10),
};

module.exports = config;
