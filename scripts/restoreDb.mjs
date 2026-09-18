// Restores a mysqldump .sql file into a target database — creating it
// first if it doesn't exist. Used both for a real disaster-recovery
// restore and for the repeatable restore-drill this script is also
// exercised by (see docs/DEPLOYMENT_RUNBOOK.md's restore-drill record).
//
// Safety: refuses to restore into the one known real application database
// name (lib/testDbSafety.js's KNOWN_NON_TEST_DB_NAMES) unless
// CONFIRM_RESTORE_PRODUCTION=true is explicitly set — restoring a backup
// OVER a live database is exactly the kind of action that must never
// happen by accident. A drill restore should always target a fresh,
// disposable database name (e.g. ending in _restore_drill), never an
// existing one.
//
// Usage:
//   node --env-file=.env scripts/restoreDb.mjs <dump.sql> <targetDbName>

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { KNOWN_NON_TEST_DB_NAMES } from "../lib/testDbSafety.js";

function findMysqlCli() {
  if (process.env.MYSQL_CLI_PATH) return process.env.MYSQL_CLI_PATH;
  const candidates = [
    "mysql",
    "/Applications/XAMPP/xamppfiles/bin/mysql",
    "/usr/local/mysql/bin/mysql",
    "/opt/homebrew/bin/mysql",
    "/usr/bin/mysql",
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  throw new Error("mysql CLI not found. Set MYSQL_CLI_PATH to its full path and retry.");
}

function run(mysqlCli, sql, env, database) {
  const args = ["-h", process.env.DB_HOST, "-P", String(process.env.DB_PORT || 3306), "-u", process.env.DB_USER];
  if (database) args.push(database);
  const result = spawnSync(mysqlCli, args, { input: sql, env, stdio: ["pipe", "inherit", "inherit"] });
  if (result.status !== 0) throw new Error(`mysql CLI exited with status ${result.status}`);
}

async function main() {
  const [, , dumpFile, targetDbName] = process.argv;
  if (!dumpFile || !targetDbName) {
    throw new Error("Usage: node scripts/restoreDb.mjs <dump.sql> <targetDbName>");
  }
  if (!existsSync(dumpFile)) throw new Error(`Dump file not found: ${dumpFile}`);
  if (KNOWN_NON_TEST_DB_NAMES.includes(targetDbName) && process.env.CONFIRM_RESTORE_PRODUCTION !== "true") {
    throw new Error(
      `Refusing to restore into "${targetDbName}" — this is the real application database. ` +
        `Restore into a fresh, disposable database name instead (a drill must never overwrite the live database), ` +
        `or set CONFIRM_RESTORE_PRODUCTION=true for a deliberate, reviewed real disaster-recovery restore.`,
    );
  }

  const { DB_HOST, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_USER) throw new Error("DB_HOST and DB_USER must be set (see .env.example).");

  const env = { ...process.env };
  if (DB_PASSWORD) env.MYSQL_PWD = DB_PASSWORD;

  const mysqlCli = findMysqlCli();
  console.log(`[restoreDb] creating database "${targetDbName}" if it doesn't exist...`);
  run(mysqlCli, `CREATE DATABASE IF NOT EXISTS \`${targetDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`, env, null);

  console.log(`[restoreDb] restoring ${dumpFile} into "${targetDbName}"...`);
  const dumpSql = readFileSync(dumpFile, "utf8");
  run(mysqlCli, dumpSql, env, targetDbName);
  console.log(`[restoreDb] done.`);
}

main().catch((err) => {
  console.error("[restoreDb] failed:", err.message || err);
  process.exitCode = 1;
});
