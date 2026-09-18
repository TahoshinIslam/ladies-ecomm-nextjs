// Local/CI-runnable backup script — dumps DB_NAME (from the active env
// file) to a timestamped .sql file via mysqldump. This is the mechanism a
// hosted deployment's backup job would also use (or a managed provider's
// equivalent automatic backup feature, once one is chosen — see
// docs/DEPLOYMENT_RUNBOOK.md for what's still an external decision).
//
// Deliberately simple and dependency-free (shells out to mysqldump rather
// than a JS reimplementation) — a full logical dump is the correct
// artifact for a restore drill and for disaster recovery on a database
// this size; a provider's own snapshot/PITR feature is the better choice
// for a real production restore-time-objective once one is provisioned.
//
// Usage:
//   node --env-file=.env scripts/backupDb.mjs [outputDir]
//   node --env-file=.env.test scripts/backupDb.mjs [outputDir]   (disposable test DB)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

function findMysqldump() {
  if (process.env.MYSQLDUMP_PATH) return process.env.MYSQLDUMP_PATH;
  const candidates = [
    "mysqldump", // rely on PATH if present
    "/Applications/XAMPP/xamppfiles/bin/mysqldump",
    "/usr/local/mysql/bin/mysqldump",
    "/opt/homebrew/bin/mysqldump",
    "/usr/bin/mysqldump",
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  throw new Error(
    "mysqldump not found on PATH or in any known install location. Set MYSQLDUMP_PATH to its full path and retry.",
  );
}

function main() {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_NAME || !DB_USER) {
    throw new Error("DB_HOST, DB_NAME, and DB_USER must be set (see .env.example).");
  }

  const outputDir = process.argv[2] || "./backups";
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(outputDir, `${DB_NAME}-${timestamp}.sql`);

  const mysqldump = findMysqldump();
  const args = [
    "-h", DB_HOST,
    "-P", String(DB_PORT || 3306),
    "-u", DB_USER,
    "--single-transaction", // consistent snapshot without locking InnoDB tables
    "--routines",
    "--triggers",
    "--result-file", outFile,
    DB_NAME,
  ];
  // Password passed via env var (MYSQL_PWD), never as a CLI arg — a CLI
  // arg is visible to any other process on the host via `ps`; an env var
  // set only for this one child process is not.
  const env = { ...process.env };
  if (DB_PASSWORD) env.MYSQL_PWD = DB_PASSWORD;

  console.log(`[backupDb] dumping "${DB_NAME}" from ${DB_HOST}:${DB_PORT || 3306} -> ${outFile}`);
  const result = spawnSync(mysqldump, args, { env, stdio: ["ignore", "inherit", "inherit"] });
  if (result.status !== 0) {
    throw new Error(`mysqldump exited with status ${result.status}`);
  }
  console.log(`[backupDb] done: ${outFile}`);
  return outFile;
}

const outFile = main();
process.stdout.write(`${outFile}\n`);
