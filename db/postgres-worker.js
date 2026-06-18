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

function connectionSummary() {
  try {
    const parsed = new URL(databaseUrl);
    const hostType =
      /^dpg-[a-z0-9-]+$/i.test(parsed.hostname) || parsed.hostname.includes(".internal")
        ? "render-internal"
        : parsed.hostname.includes("render.com")
          ? "render-external"
          : "external";
    return `host=${parsed.hostname} port=${parsed.port || "5432"} database=${parsed.pathname.replace(/^\//, "")} ssl=${needsSsl ? "on" : "off"} type=${hostType}`;
  } catch {
    return "DATABASE_URL could not be parsed";
  }
}

// eslint-disable-next-line no-console
console.log(`[postgres-worker] ready ${connectionSummary()}`);

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || 10000),
  idleTimeoutMillis: 10000,
  query_timeout: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || 20000),
  statement_timeout: Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS || 20000)
});

let txClient = null;
let txDepth = 0;

async function runQuery(sql, params) {
  const normalized = String(sql || "").trim();
  const preview = normalized.replace(/\s+/g, " ").slice(0, 140);
  // eslint-disable-next-line no-console
  console.log(`[postgres-worker] query start: ${preview}`);
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
  // eslint-disable-next-line no-console
  console.log(`[postgres-worker] query ok: ${preview}`);
  return { rows: result.rows || [], rowCount: result.rowCount || 0 };
}

parentPort.on("message", async ({ requestPath, responsePath, signalPath }) => {
  let response;
  try {
    const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const timeoutMs = Number(process.env.POSTGRES_WORKER_TIMEOUT_MS || 25000);
    const timeout = new Promise((_, reject) => {
      setTimeout(() => {
        const preview = String(request.sql || "").replace(/\s+/g, " ").trim().slice(0, 180);
        reject(
          new Error(
            `Postgres query did not finish within ${timeoutMs}ms. Check DATABASE_URL, network access, SSL settings, and database availability. SQL: ${preview}`
          )
        );
      }, timeoutMs);
    });
    response = { ok: true, result: await Promise.race([runQuery(request.sql, request.params), timeout]) };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[postgres-worker] query failed", {
      message: error?.message || "Postgres query failed.",
      code: error?.code || "",
      detail: error?.detail || ""
    });
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
