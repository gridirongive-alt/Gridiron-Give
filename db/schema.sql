PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS coaches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  "PW_Recovery_Key" TEXT NOT NULL,
  team_name TEXT NOT NULL DEFAULT '',
  stripe_account_id TEXT NOT NULL DEFAULT '',
  stripe_onboarding_complete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  coach_id TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT DEFAULT '',
  sport TEXT NOT NULL DEFAULT 'football',
  recipient_mode TEXT NOT NULL DEFAULT 'coach',
  logo_data_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  team_name TEXT NOT NULL DEFAULT '',
  player_public_id TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL DEFAULT '',
  "PW_Recovery_Key" TEXT NOT NULL,
  registered INTEGER NOT NULL DEFAULT 0,
  image_data_url TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0,
  stripe_account_id TEXT NOT NULL DEFAULT '',
  stripe_onboarding_complete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_players_team_id ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);
CREATE INDEX IF NOT EXISTS idx_players_public_id ON players(player_public_id);

CREATE TABLE IF NOT EXISTS equipment_items (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  price_range TEXT NOT NULL DEFAULT '',
  goal REAL NOT NULL DEFAULT 0,
  raised REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_equipment_player_id ON equipment_items(player_id);

CREATE TABLE IF NOT EXISTS team_equipment_templates (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  price_range TEXT NOT NULL DEFAULT '',
  goal REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_equipment_team_id ON team_equipment_templates(team_id);

CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL DEFAULT '',
  player_id TEXT NOT NULL,
  equipment_item_id TEXT NOT NULL,
  donor_name TEXT NOT NULL,
  donor_email TEXT NOT NULL,
  donor_message TEXT NOT NULL DEFAULT '',
  anonymous INTEGER NOT NULL DEFAULT 0,
  amount REAL NOT NULL,
  payout_recipient_type TEXT NOT NULL DEFAULT 'player',
  payout_recipient_id TEXT NOT NULL DEFAULT '',
  stripe_destination_account_id TEXT NOT NULL DEFAULT '',
  stripe_checkout_session_id TEXT NOT NULL DEFAULT '',
  stripe_payment_intent_id TEXT NOT NULL DEFAULT '',
  stripe_charge_id TEXT NOT NULL DEFAULT '',
  checkout_total_amount REAL NOT NULL DEFAULT 0,
  application_fee_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_item_id) REFERENCES equipment_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_donations_player_id ON donations(player_id);

CREATE TABLE IF NOT EXISTS processed_checkout_sessions (
  session_id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL DEFAULT '',
  charge_id TEXT NOT NULL DEFAULT '',
  transfer_id TEXT NOT NULL DEFAULT '',
  player_id TEXT NOT NULL DEFAULT '',
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
