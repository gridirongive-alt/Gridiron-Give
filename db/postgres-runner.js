import fs from "node:fs";
import pg from "pg";

const { Client, types } = pg;

types.setTypeParser(1082, (value) => value);
types.setTypeParser(1114, (value) => value);
types.setTypeParser(1184, (value) => value);

const [, , requestPath, responsePath] = process.argv;
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const needsSsl =
  /\bsslmode=require\b/i.test(databaseUrl) ||
  String(process.env.PGSSLMODE || "").toLowerCase() === "require" ||
  String(process.env.POSTGRES_SSL || "").toLowerCase() === "true";

function writeResponse(response) {
  fs.writeFileSync(responsePath, JSON.stringify(response));
}

async function main() {
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const client = new Client({
    connectionString: databaseUrl,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || 8000),
    query_timeout: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || 12000),
    statement_timeout: Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS || 12000)
  });

  try {
    await client.connect();
    const result = await client.query(request.sql, request.params || []);
    writeResponse({
      ok: true,
      result: {
        rows: result.rows || [],
        rowCount: result.rowCount || 0
      }
    });
  } catch (error) {
    writeResponse({
      ok: false,
      error: {
        message: error?.message || "Postgres query failed.",
        code: error?.code || "",
        detail: error?.detail || ""
      }
    });
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore close errors after failed connection attempts.
    }
  }
}

main().catch((error) => {
  writeResponse({
    ok: false,
    error: {
      message: error?.message || "Postgres runner failed.",
      code: error?.code || "",
      detail: error?.detail || ""
    }
  });
});
