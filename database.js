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
  if (!hasColumn("players", "team_name")) {
    db.prepare('ALTER TABLE players ADD COLUMN "team_name" TEXT NOT NULL DEFAULT ""').run();
  }
}

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

export { uid, playerPublicId, equipmentTemplateForSport, recoveryKey, passwordHash, isBcryptHash };
