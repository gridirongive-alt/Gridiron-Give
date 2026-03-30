import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const rootDir = process.cwd();
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(rootDir, "data");
const dbPath = path.join(dataDir, "gridiron-give.sqlite");
const backupDir = path.join(dataDir, "backups");
const latestJsonBackupPath = path.join(backupDir, "gridiron-give-backup-latest.json");
const latestExcelBackupPath = path.join(backupDir, "gridiron-give-backup-latest.xml");
const schemaPath = path.join(rootDir, "db", "schema.sql");

function randomPart(length) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function uid(prefix) {
  return `${prefix}-${randomPart(8)}`;
}

function playerPublicId() {
  return `GG-${randomPart(3)}-${randomPart(4)}`;
}

function recoveryKey() {
  return randomBytes(24).toString("hex");
}

function passwordHash(password) {
  return bcrypt.hashSync(String(password), 12);
}

function isBcryptHash(value) {
  return /^\$2[aby]\$/.test(String(value || ""));
}

function equipmentTemplateForSport(sport) {
  const items = {
    football: [
      ["Helmet", "Protection", "$250 - $450"],
      ["Shoulder Pads", "Protection", "$150 - $300"],
      ["Cleats", "Footwear", "$50 - $150"],
      ["Practice Jersey", "Apparel", "$20 - $40"],
      ["Game Jersey", "Apparel", "$50 - $120"],
      ["Integrated Padded Pants", "Protection", "$40 - $80"],
      ["Girdle", "Protection", "$30 - $60"],
      ["Mouthguard", "Protection", "$10 - $25"],
      ["Gloves", "Accessories", "$30 - $65"],
      ["Kicking Cleats", "Footwear", "$60 - $170"]
    ],
    hockey: [
      ["Skates", "Footwear", "$150 - $600"],
      ["Hockey Stick", "Gear", "$50 - $250"],
      ["Helmet with Cage", "Protection", "$100 - $250"],
      ["Gloves", "Protection", "$60 - $150"],
      ["Shoulder Pads", "Protection", "$70 - $180"],
      ["Elbow Pads", "Protection", "$40 - $90"],
      ["Shin Guards", "Protection", "$50 - $120"],
      ["Hockey Pants", "Protection", "$60 - $160"],
      ["Neck Guard", "Protection", "$15 - $30"]
    ],
    lacrosse: [
      ["Lacrosse Helmet", "Protection", "$200 - $350"],
      ["Lacrosse Stick (Complete)", "Gear", "$60 - $200"],
      ["Shoulder Pads", "Protection", "$70 - $150"],
      ["Gloves", "Protection", "$50 - $180"],
      ["Arm Pads", "Protection", "$40 - $90"],
      ["Cleats", "Footwear", "$60 - $130"],
      ["Mouthguard", "Protection", "$10 - $25"],
      ["Rib Pads (Optional)", "Protection", "$30 - $70"]
    ],
    baseball: [
      ["Baseball Glove", "Gear", "$50 - $250"],
      ["BBCOR/USSSA Bat", "Gear", "$150 - $450"],
      ["Batting Helmet", "Protection", "$30 - $70"],
      ["Cleats", "Footwear", "$50 - $120"],
      ["Batting Gloves", "Accessories", "$20 - $50"],
      ["Catcher's Gear Set (If applicable)", "Protection", "$150 - $400"],
      ["Baseball Pants", "Apparel", "$20 - $50"],
      ["Equipment Bag", "Accessories", "$30 - $100"]
    ]
  };
  return items[sport] || items.football;
}

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(fs.readFileSync(schemaPath, "utf8"));

function hasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((col) => String(col.name) === columnName);
}

function ensureColumns() {
  if (!hasColumn("coaches", "PW_Recovery_Key")) {
    db.prepare('ALTER TABLE coaches ADD COLUMN "PW_Recovery_Key" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("players", "PW_Recovery_Key")) {
    db.prepare('ALTER TABLE players ADD COLUMN "PW_Recovery_Key" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("coaches", "team_name")) {
    db.prepare('ALTER TABLE coaches ADD COLUMN "team_name" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("coaches", "stripe_account_id")) {
    db.prepare('ALTER TABLE coaches ADD COLUMN "stripe_account_id" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("coaches", "stripe_onboarding_complete")) {
    db.prepare('ALTER TABLE coaches ADD COLUMN "stripe_onboarding_complete" INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!hasColumn("teams", "recipient_mode")) {
    db.prepare('ALTER TABLE teams ADD COLUMN "recipient_mode" TEXT NOT NULL DEFAULT "coach"').run();
  }
  if (!hasColumn("teams", "logo_data_url")) {
    db.prepare('ALTER TABLE teams ADD COLUMN "logo_data_url" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("players", "team_name")) {
    db.prepare('ALTER TABLE players ADD COLUMN "team_name" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("players", "stripe_account_id")) {
    db.prepare('ALTER TABLE players ADD COLUMN "stripe_account_id" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("players", "stripe_onboarding_complete")) {
    db.prepare('ALTER TABLE players ADD COLUMN "stripe_onboarding_complete" INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!hasColumn("donations", "stripe_checkout_session_id")) {
    db.prepare('ALTER TABLE donations ADD COLUMN "stripe_checkout_session_id" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("donations", "stripe_payment_intent_id")) {
    db.prepare('ALTER TABLE donations ADD COLUMN "stripe_payment_intent_id" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("donations", "stripe_charge_id")) {
    db.prepare('ALTER TABLE donations ADD COLUMN "stripe_charge_id" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("donations", "checkout_total_amount")) {
    db.prepare('ALTER TABLE donations ADD COLUMN "checkout_total_amount" REAL NOT NULL DEFAULT 0').run();
  }
  if (!hasColumn("donations", "application_fee_amount")) {
    db.prepare('ALTER TABLE donations ADD COLUMN "application_fee_amount" REAL NOT NULL DEFAULT 0').run();
  }
  if (!hasColumn("donations", "team_id")) {
    db.prepare('ALTER TABLE donations ADD COLUMN "team_id" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("donations", "payout_recipient_type")) {
    db.prepare('ALTER TABLE donations ADD COLUMN "payout_recipient_type" TEXT NOT NULL DEFAULT "player"').run();
  }
  if (!hasColumn("donations", "payout_recipient_id")) {
    db.prepare('ALTER TABLE donations ADD COLUMN "payout_recipient_id" TEXT NOT NULL DEFAULT ""').run();
  }
  if (!hasColumn("donations", "stripe_destination_account_id")) {
    db.prepare('ALTER TABLE donations ADD COLUMN "stripe_destination_account_id" TEXT NOT NULL DEFAULT ""').run();
  }
}

db.exec(`
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
`);

function migratePasswordsAndRecoveryKeys() {
  const coaches = db.prepare('SELECT id, password, "PW_Recovery_Key" AS recovery_key FROM coaches').all();
  coaches.forEach((coach) => {
    const nextPassword = isBcryptHash(coach.password) ? coach.password : passwordHash(coach.password || "password123");
    const nextRecovery = coach.recovery_key || recoveryKey();
    db.prepare('UPDATE coaches SET password=?, "PW_Recovery_Key"=? WHERE id=?').run(
      nextPassword,
      nextRecovery,
      coach.id
    );
  });

  const players = db.prepare('SELECT id, password, "PW_Recovery_Key" AS recovery_key FROM players').all();
  players.forEach((player) => {
    const currentPassword = String(player.password || "");
    const nextPassword =
      currentPassword.length === 0
        ? ""
        : isBcryptHash(currentPassword)
          ? currentPassword
          : passwordHash(currentPassword);
    const nextRecovery = player.recovery_key || recoveryKey();
    db.prepare('UPDATE players SET password=?, "PW_Recovery_Key"=? WHERE id=?').run(
      nextPassword,
      nextRecovery,
      player.id
    );
  });

  db.prepare(
    `UPDATE coaches
     SET team_name = COALESCE(
       (SELECT t.name FROM teams t WHERE t.coach_id = coaches.id LIMIT 1),
       team_name
     )`
  ).run();

  db.prepare(
    `UPDATE players
     SET team_name = COALESCE(
       (SELECT t.name FROM teams t WHERE t.id = players.team_id LIMIT 1),
       team_name
     )`
  ).run();
}

ensureColumns();
migratePasswordsAndRecoveryKeys();

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildBackupSnapshot() {
  return {
    generated_at: new Date().toISOString(),
    source_db_path: dbPath,
    tables: {
      coaches: db.prepare("SELECT * FROM coaches ORDER BY created_at ASC, rowid ASC").all(),
      teams: db.prepare("SELECT * FROM teams ORDER BY created_at ASC, rowid ASC").all(),
      players: db.prepare("SELECT * FROM players ORDER BY created_at ASC, rowid ASC").all(),
      team_equipment_templates: db
        .prepare("SELECT * FROM team_equipment_templates ORDER BY team_id ASC, sort_order ASC, rowid ASC")
        .all(),
      equipment_items: db
        .prepare("SELECT * FROM equipment_items ORDER BY player_id ASC, sort_order ASC, rowid ASC")
        .all(),
      donations: db.prepare("SELECT * FROM donations ORDER BY created_at ASC, rowid ASC").all(),
      processed_checkout_sessions: db
        .prepare("SELECT * FROM processed_checkout_sessions ORDER BY processed_at ASC, rowid ASC")
        .all()
    }
  };
}

function spreadsheetCell(value) {
  if (value === null || value === undefined) {
    return '<Cell><Data ss:Type="String"></Data></Cell>';
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  if (typeof value === "boolean") {
    return `<Cell><Data ss:Type="String">${value ? "TRUE" : "FALSE"}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function buildExcelWorkbook(snapshot) {
  const worksheetXml = Object.entries(snapshot.tables)
    .map(([tableName, rows]) => {
      const columns = Array.from(
        rows.reduce((set, row) => {
          Object.keys(row || {}).forEach((key) => set.add(key));
          return set;
        }, new Set())
      );
      const headerRow = columns.map((column) => spreadsheetCell(column)).join("");
      const bodyRows = rows
        .map((row) => {
          const cells = columns.map((column) => spreadsheetCell(row?.[column])).join("");
          return `<Row>${cells}</Row>`;
        })
        .join("");
      return `
        <Worksheet ss:Name="${escapeXml(tableName.slice(0, 31) || "Sheet")}">
          <Table>
            <Row>${headerRow}</Row>
            ${bodyRows}
          </Table>
        </Worksheet>
      `;
    })
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Author>Gridiron Give</Author>
    <Created>${escapeXml(snapshot.generated_at)}</Created>
  </DocumentProperties>
  ${worksheetXml}
</Workbook>`;
}

function writeLatestBackupSnapshot() {
  const snapshot = buildBackupSnapshot();
  fs.writeFileSync(latestJsonBackupPath, JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(latestExcelBackupPath, buildExcelWorkbook(snapshot));
  return {
    jsonPath: latestJsonBackupPath,
    excelPath: latestExcelBackupPath
  };
}

export {
  uid,
  playerPublicId,
  equipmentTemplateForSport,
  recoveryKey,
  passwordHash,
  isBcryptHash,
  writeLatestBackupSnapshot,
  backupDir,
  latestJsonBackupPath,
  latestExcelBackupPath
};
