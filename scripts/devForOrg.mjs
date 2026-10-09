/**
 * Run this storefront for ANOTHER shop (organization) of the shared database, for looking at its online store while developing.
 *
 *   npm run dev:org -- <organization-id> [port]        e.g.  npm run dev:org -- org_327027da741c3d29 3101
 *
 * One storefront serves exactly one shop (STORE_ORGANIZATION_ID — see lib/tenant.js), so seeing a second shop's website means a second
 * storefront process for it: this starts one on its own port with its own build folder, leaving the normal `npm run dev` (port 3100,
 * the organization in .env) untouched. The organization ids are listed in the dashboard under Settings → Workspace.
 */
import { spawn } from "node:child_process";

const [orgId, portArg] = process.argv.slice(2);
if (!orgId || !/^[A-Za-z0-9_-]{3,64}$/.test(orgId)) {
  console.error("Usage: npm run dev:org -- <organization-id> [port]");
  process.exit(1);
}
const port = String(Number(portArg) || 3101);
if (port === "3100") {
  console.error("Port 3100 is the main storefront's. Pick another (default 3101).");
  process.exit(1);
}

console.log(`Storefront for ${orgId} on http://localhost:${port}`);
const child = spawn("npx", ["next", "dev", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, STORE_ORGANIZATION_ID: orgId, NEXT_DIST_DIR: `.next-${orgId}`, CLIENT_URL: `http://localhost:${port}` },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
