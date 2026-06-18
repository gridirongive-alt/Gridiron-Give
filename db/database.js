import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = process.cwd();
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, "data");
const backupDir = path.join(dataDir, "backups");
const latestJsonBackupPath = path.join(backupDir, "gridiron-give-backup-latest.json");
const latestExcelBackupPath = path.join(backupDir, "gridiron-give-backup-latest.xls");
const schemaPath = path.join(__dirname, "schema.sql");
const databaseUrl = String(process.env.DATABASE_URL || "").trim();

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. Gridiron Give now uses Postgres only; SQLite fallback is disabled."
  );
}

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

function databaseConnectionSummary() {
  try {
    const parsed = new URL(databaseUrl);
    const sslMode = parsed.searchParams.get("sslmode") || "not set";
    const hostType =
      /^dpg-[a-z0-9-]+$/i.test(parsed.hostname) || parsed.hostname.includes(".internal")
        ? "render-internal"
        : parsed.hostname.includes("render.com")
          ? "render-external"
          : "external";
    return `host=${parsed.hostname} port=${parsed.port || "5432"} database=${parsed.pathname.replace(/^\//, "")} sslmode=${sslMode} type=${hostType}`;
  } catch {
    return "DATABASE_URL could not be parsed";
  }
}

// eslint-disable-next-line no-console
console.log(`[postgres] starting with ${databaseConnectionSummary()}`);

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

const numericColumns = new Set([
  "count",
  "goal",
  "raised",
  "amount",
  "checkout_total_amount",
  "application_fee_amount",
  "enabled",
  "registered",
  "published",
  "sort_order",
  "stripe_onboarding_complete",
  "goal_total",
  "raised_total"
]);

function normalizeRows(rows) {
  return (rows || []).map((row) => {
    const next = {};
    Object.entries(row).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        next[key] = value;
        return;
      }
      if (numericColumns.has(key) && typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
        next[key] = Number(value);
        return;
      }
      next[key] = value;
    });
    return next;
  });
}

function replaceQuestionPlaceholders(sql) {
  let index = 0;
  let output = "";
  let single = false;
  let double = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const prev = sql[i - 1];
    if (char === "'" && single && sql[i + 1] === "'") {
      output += "''";
      i += 1;
      continue;
    }
    if (char === "'" && !double && prev !== "\\") single = !single;
    if (char === '"' && !single && prev !== "\\") double = !double;
    if (char === "?" && !single && !double) {
      index += 1;
      output += `$${index}`;
      continue;
    }
    output += char;
  }
  return output;
}

function parsePragmaTableInfo(sql) {
  const match = String(sql || "").trim().match(/^PRAGMA\s+table_info\(([^)]+)\)/i);
  if (!match) return null;
  return match[1].replace(/["'`]/g, "").trim();
}

function transformSql(sql) {
  return replaceQuestionPlaceholders(
    String(sql || "")
      .replace(/ORDER BY rowid DESC/gi, "ORDER BY id DESC")
      .replace(/ORDER BY rowid ASC/gi, "ORDER BY id ASC")
      .replace(/,\s*rowid\s+ASC/gi, ", id ASC")
      .replace(/,\s*rowid\s+DESC/gi, ", id DESC")
  );
}

class PostgresStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.tableInfoName = parsePragmaTableInfo(sql);
  }

  all(...params) {
    if (this.tableInfoName) return this.database.tableInfo(this.tableInfoName);
    return this.database.query(this.sql, params).rows;
  }

  get(...params) {
    return this.all(...params)[0];
  }

  run(...params) {
    const result = this.database.query(this.sql, params);
    return {
      changes: result.rowCount,
      lastInsertRowid: 0
    };
  }
}

class PostgresSyncDatabase {
  constructor() {
    this.runnerPath = path.join(__dirname, "postgres-runner.js");
    this.workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gridiron-give-pg-"));
  }

  prepare(sql) {
    return new PostgresStatement(this, sql);
  }

  exec(sql) {
    const statements = String(sql || "")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .filter((statement) => !/^PRAGMA\b/i.test(statement));
    statements.forEach((statement) => this.query(statement, []));
  }

  pragma() {
    return undefined;
  }

  transaction(callback) {
    return (...args) => {
      try {
        const result = callback(...args);
        return result;
      } catch (error) {
        throw error;
      }
    };
  }

  tableInfo(tableName) {
    return this.query(
      `SELECT
         ordinal_position - 1 AS cid,
         column_name AS name,
         data_type AS type,
         CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
         column_default AS dflt_value,
         CASE WHEN column_name = 'id' OR column_name = 'session_id' THEN 1 ELSE 0 END AS pk
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ?
       ORDER BY ordinal_position`,
      [tableName]
    ).rows;
  }

  query(sql, params) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const requestPath = path.join(this.workDir, `${id}.request.json`);
    const responsePath = path.join(this.workDir, `${id}.response.json`);
    const request = {
      sql: transformSql(sql),
      params
    };
    fs.writeFileSync(requestPath, JSON.stringify(request));

    const timeoutMs = Number(process.env.POSTGRES_PARENT_TIMEOUT_MS || 20000);
    try {
      execFileSync(process.execPath, [this.runnerPath, requestPath, responsePath], {
        cwd: rootDir,
        env: {
          ...process.env,
          GRIDIRON_GIVE_ROOT_DIR: rootDir,
          NODE_PATH: path.join(rootDir, "node_modules")
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs
      });
    } catch (error) {
      const preview = request.sql.replace(/\s+/g, " ").trim().slice(0, 180);
      const stderr = String(error?.stderr || "").trim();
      const detail = stderr ? ` ${stderr}` : "";
      throw new Error(
        `Postgres query failed or timed out after ${timeoutMs}ms. Check DATABASE_URL, database status, and Render network access. SQL: ${preview}${detail}`
      );
    }

    const response = JSON.parse(fs.readFileSync(responsePath, "utf8"));
    [requestPath, responsePath].forEach((filePath) => {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Ignore cleanup races during process shutdown.
      }
    });
    if (!response.ok) {
      const detail = response.error?.detail ? ` ${response.error.detail}` : "";
      throw new Error(`${response.error?.message || "Postgres query failed."}${detail}`);
    }
    return {
      rows: normalizeRows(response.result.rows),
      rowCount: Number(response.result.rowCount || 0)
    };
  }
}

export const db = new PostgresSyncDatabase();

function verifyConnection() {
  // eslint-disable-next-line no-console
  console.log("[postgres] verifying connection with SELECT 1");
  db.prepare("SELECT 1 AS ok").get();
  // eslint-disable-next-line no-console
  console.log("[postgres] connection verified");
}

function ensureSchema() {
  db.exec(fs.readFileSync(schemaPath, "utf8"));
}

function hasColumn(tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((col) => String(col.name) === columnName);
}

function ensureColumn(tableName, columnName, definition) {
  if (!hasColumn(tableName, columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`).run();
  }
}

function ensureColumns() {
  ensureColumn("coaches", "PW_Recovery_Key", '"PW_Recovery_Key" TEXT NOT NULL DEFAULT \'\'');
  ensureColumn("coaches", "team_name", "team_name TEXT NOT NULL DEFAULT ''");
  ensureColumn("coaches", "stripe_account_id", "stripe_account_id TEXT NOT NULL DEFAULT ''");
  ensureColumn("coaches", "stripe_onboarding_complete", "stripe_onboarding_complete INTEGER NOT NULL DEFAULT 0");
  ensureColumn("teams", "recipient_mode", "recipient_mode TEXT NOT NULL DEFAULT 'coach'");
  ensureColumn("teams", "logo_data_url", "logo_data_url TEXT NOT NULL DEFAULT ''");
  ensureColumn("teams", "theme_color", "theme_color TEXT NOT NULL DEFAULT ''");
  ensureColumn("players", "PW_Recovery_Key", '"PW_Recovery_Key" TEXT NOT NULL DEFAULT \'\'');
  ensureColumn("players", "team_name", "team_name TEXT NOT NULL DEFAULT ''");
  ensureColumn("players", "stripe_account_id", "stripe_account_id TEXT NOT NULL DEFAULT ''");
  ensureColumn("players", "stripe_onboarding_complete", "stripe_onboarding_complete INTEGER NOT NULL DEFAULT 0");
  ensureColumn("donations", "stripe_checkout_session_id", "stripe_checkout_session_id TEXT NOT NULL DEFAULT ''");
  ensureColumn("donations", "stripe_payment_intent_id", "stripe_payment_intent_id TEXT NOT NULL DEFAULT ''");
  ensureColumn("donations", "stripe_charge_id", "stripe_charge_id TEXT NOT NULL DEFAULT ''");
  ensureColumn("donations", "checkout_total_amount", "checkout_total_amount DOUBLE PRECISION NOT NULL DEFAULT 0");
  ensureColumn("donations", "application_fee_amount", "application_fee_amount DOUBLE PRECISION NOT NULL DEFAULT 0");
  ensureColumn("donations", "team_id", "team_id TEXT NOT NULL DEFAULT ''");
  ensureColumn("donations", "payout_recipient_type", "payout_recipient_type TEXT NOT NULL DEFAULT 'player'");
  ensureColumn("donations", "payout_recipient_id", "payout_recipient_id TEXT NOT NULL DEFAULT ''");
  ensureColumn("donations", "stripe_destination_account_id", "stripe_destination_account_id TEXT NOT NULL DEFAULT ''");
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

verifyConnection();
ensureSchema();
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
    source_db: "postgres",
    tables: {
      coaches: db.prepare("SELECT * FROM coaches ORDER BY created_at ASC, id ASC").all(),
      teams: db.prepare("SELECT * FROM teams ORDER BY created_at ASC, id ASC").all(),
      players: db.prepare("SELECT * FROM players ORDER BY created_at ASC, id ASC").all(),
      team_equipment_templates: db
        .prepare("SELECT * FROM team_equipment_templates ORDER BY team_id ASC, sort_order ASC, id ASC")
        .all(),
      equipment_items: db
        .prepare("SELECT * FROM equipment_items ORDER BY player_id ASC, sort_order ASC, id ASC")
        .all(),
      donations: db.prepare("SELECT * FROM donations ORDER BY created_at ASC, id ASC").all(),
      processed_checkout_sessions: db
        .prepare("SELECT * FROM processed_checkout_sessions ORDER BY processed_at ASC, session_id ASC")
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
