import fs from "node:fs";
import { parentPort } from "node:worker_threads";
import pg from "pg";

const { Pool, types } = pg;

// Keep timestamp values stable for existing JSON/API responses.
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
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined
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

parentPort.on("message", async ({ requestPath, responsePath, signalPath }) => {
  let response;
  try {
    const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    response = { ok: true, result: await runQuery(request.sql, request.params) };
  } catch (error) {
    response = {
      ok: false,
      error: {
        message: error?.message || "Postgres query failed.",
        code: error?.code || "",
        detail: error?.detail || ""
      }
    };
  }

  fs.writeFileSync(responsePath, JSON.stringify(response));
  fs.writeFileSync(signalPath, "done");
});
