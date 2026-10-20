-- League Settings KV Store
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Admin users (SuperAdmins by WhatsApp JID or phone number)
CREATE TABLE IF NOT EXISTS admins (
    whatsapp_id TEXT PRIMARY KEY,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Players Table (Multi-League scoped by league_id / groupId)
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT DEFAULT 'default',
    name TEXT NOT NULL COLLATE NOCASE,
    whatsapp_id TEXT,
    joined_week INTEGER DEFAULT 1,
    active INTEGER DEFAULT 1,
    baseline_played INTEGER DEFAULT 0,
    baseline_won INTEGER DEFAULT 0,
    baseline_drawn INTEGER DEFAULT 0,
    baseline_lost INTEGER DEFAULT 0,
    baseline_gf INTEGER DEFAULT 0,
    baseline_ga INTEGER DEFAULT 0,
    baseline_points INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Fixtures Table (Multi-League scoped by league_id / groupId)
CREATE TABLE IF NOT EXISTS fixtures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT DEFAULT 'default',
    week INTEGER NOT NULL,
    home_player_id INTEGER NOT NULL,
    away_player_id INTEGER NOT NULL,
    score_home INTEGER DEFAULT NULL,
    score_away INTEGER DEFAULT NULL,
    status TEXT CHECK(status IN ('pending', 'played', 'forfeited')) DEFAULT 'pending',
    deadline DATETIME NOT NULL,
    is_backfill INTEGER DEFAULT 0,
    played_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(home_player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY(away_player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_players_league ON players(league_id, name);
CREATE INDEX IF NOT EXISTS idx_fixtures_league ON fixtures(league_id, week);
CREATE INDEX IF NOT EXISTS idx_fixtures_status ON fixtures(league_id, status);
CREATE INDEX IF NOT EXISTS idx_fixtures_players ON fixtures(home_player_id, away_player_id);
