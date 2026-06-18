import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";

const rootDir = process.env.GRIDIRON_GIVE_ROOT_DIR || process.cwd();
const require = createRequire(path.join(rootDir, "server.js"));
const pg = require("pg");
const { Pool, types } = pg;

types.setTypeParser(1082, (value) => value);
types.setTypeParser(1114, (value) => value);
types.setTypeParser(1184, (value) => value);

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const needsSsl =
  /\bsslmode=require\b/i.test(databaseUrl) ||
  String(process.env.PGSSLMODE || "").toLowerCase() === "require" ||
  String(process.env.POSTGRES_SSL || "").toLowerCase() === "true";

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || 8000),
  idleTimeoutMillis: 10000,
  query_timeout: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || 12000),
  statement_timeout: Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS || 12000)
});

let txClient = null;
let txDepth = 0;

async function runQuery(sql, params) {
  const normalized = String(sql || "").trim();
  if (normalized === "__BEGIN__") {
    if (txDepth === 0) {
      txClient = await pool.connect();
      await txClient.query("BEGIN");
    }
    txDepth += 1;
    return { rows: [], rowCount: 0 };
  }
  if (normalized === "__COMMIT__") {
    if (txClient && txDepth <= 1) {
      await txClient.query("COMMIT");
      txClient.release();
      txClient = null;
      txDepth = 0;
      return { rows: [], rowCount: 0 };
    }
    txDepth = Math.max(0, txDepth - 1);
    return { rows: [], rowCount: 0 };
  }
  if (normalized === "__ROLLBACK__") {
    if (txClient) {
      await txClient.query("ROLLBACK");
      txClient.release();
      txClient = null;
    }
    txDepth = 0;
    return { rows: [], rowCount: 0 };
  }
  const client = txClient || pool;
  const result = await client.query(normalized, params || []);
  return { rows: result.rows || [], rowCount: result.rowCount || 0 };
}

function writeResponse(responsePath, signalPath, response) {
  fs.writeFileSync(responsePath, JSON.stringify(response));
  fs.writeFileSync(signalPath, "done");
}

parentPort.on("message", async ({ requestPath, responsePath, signalPath }) => {
  try {
    const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const result = await runQuery(request.sql, request.params);
    writeResponse(responsePath, signalPath, { ok: true, result });
  } catch (error) {
    writeResponse(responsePath, signalPath, {
      ok: false,
      error: {
        message: error?.message || "Postgres query failed.",
        code: error?.code || "",
        detail: error?.detail || ""
      }
    });
  }
});
