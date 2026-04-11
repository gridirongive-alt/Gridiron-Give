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
const latestExcelBackupPath = path.join(backupDir, "gridiron-give-backup-latest.xls");
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
      ["Jersey/Pants", "Apparel", "$20 - $40"],
      ["Practice Gear", "Apparel", "$50 - $120"],
      ["Girdle/Lower Body Pads", "Protection", "$40 - $80"],
      ["Back Plate/Rib Protection", "Protection", "$30 - $60"],
      ["Mouthguard/Chinstrap", "Protection", "$10 - $25"],
      ["Gloves", "Accessories", "$30 - $65"],
      ["Training Shoes", "Footwear", "$60 - $170"],
      ["Season Referee Fees", "Officiating", "$600 - $1,500"],
      ["Season Field Rental", "Facilities", "$500 - $2,000"]
    ],
    "ice hockey": [
      ["Skates", "Footwear", "$150 - $600"],
      ["Helmet (with Cage)", "Protection", "$80 - $250"],
      ["Sticks (2x)", "Equipment", "$100 - $400"],
      ["Gloves", "Protection", "$60 - $180"],
      ["Pads (Shoulder/Shin/Elbow)", "Protection", "$150 - $350"],
      ["Breezers/Pants", "Apparel", "$80 - $200"],
      ["Season Official Fees", "Officiating", "$500 - $1,200"],
      ["Season Ice Rental", "Facilities", "$2,000 - $6,000"]
    ],
    lacrosse: [
      ["Stick (Complete)", "Equipment", "$80 - $250"],
      ["Helmet (Men's) or Goggles (Women's)", "Protection", "$40 - $350"],
      ["Gloves", "Protection", "$70 - $180"],
      ["Pads (Shoulder/Arm/Ribs)", "Protection", "$120 - $300"],
      ["Cleats", "Footwear", "$60 - $130"],
      ["Season Official Fees", "Officiating", "$400 - $1,000"],
      ["Season Field/Turf Rental", "Facilities", "$600 - $1,800"]
    ],
    baseball: [
      ["Glove", "Equipment", "$60 - $250"],
      ["Bat", "Equipment", "$100 - $450"],
      ["Helmet", "Protection", "$40 - $100"],
      ["Cleats", "Footwear", "$50 - $120"],
      ["Uniform/Pants", "Apparel", "$50 - $150"],
      ["Season Umpire Fees", "Officiating", "$500 - $1,100"],
      ["Season Field Maintenance/Rental", "Facilities", "$400 - $1,200"]
    ],
    "field hockey": [
      ["Stick", "Equipment", "$50 - $300"],
      ["Shin Guards & Goggles", "Protection", "$70 - $160"],
      ["Turf Shoes", "Footwear", "$60 - $140"],
      ["Season Umpire Fees", "Officiating", "$350 - $900"],
      ["Season Turf Rental", "Facilities", "$500 - $1,500"]
    ],
    basketball: [
      ["Basketball Shoes", "Footwear", "$80 - $180"],
      ["Uniform/Warm-ups", "Apparel", "$60 - $150"],
      ["Ball", "Equipment", "$30 - $70"],
      ["Season Referee Fees", "Officiating", "$400 - $950"],
      ["Season Gym Rental", "Facilities", "$600 - $2,000"]
    ],
    soccer: [
      ["Cleats", "Footwear", "$50 - $200"],
      ["Shin Guards", "Protection", "$15 - $50"],
      ["Uniform/Training Gear", "Apparel", "$70 - $200"],
      ["Season Referee Fees", "Officiating", "$450 - $1,200"],
      ["Season Field Rental", "Facilities", "$400 - $1,500"]
    ],
    volleyball: [
      ["Court Shoes", "Footwear", "$70 - $150"],
      ["Knee Pads", "Protection", "$25 - $50"],
      ["Jersey/Spandex", "Apparel", "$50 - $120"],
      ["Season Official Fees", "Officiating", "$350 - $800"],
      ["Season Court Rental", "Facilities", "$500 - $1,800"]
    ],
    tennis: [
      ["Racket(s)", "Equipment", "$100 - $400"],
      ["Court Shoes", "Footwear", "$70 - $160"],
      ["Tennis Whites/Athletic Wear", "Apparel", "$50 - $150"],
      ["Tournament Official Fees", "Officiating", "$200 - $600"],
      ["Season Court Membership/Rental", "Facilities", "$200 - $800"]
    ],
    golf: [
      ["Clubs (Full Set)", "Equipment", "$300 - $1,200"],
      ["Golf Bag", "Equipment", "$100 - $250"],
      ["Golf Shoes", "Footwear", "$70 - $180"],
      ["Tournament/Rules Officials", "Officiating", "$150 - $500"],
      ["Season Greens Fees/Range Access", "Facilities", "$400 - $2,500"]
    ]
  };
  if (sport === "hockey") return items["ice hockey"];
  if (sport === "baseball/softball") return items.baseball;
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
