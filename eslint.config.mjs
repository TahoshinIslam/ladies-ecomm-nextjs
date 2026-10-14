import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // zod is configured once in lib/zod.js (jitless, so it never probes eval
  // under the Content-Security-Policy). Importing "zod" directly would skip that.
  {
    ignores: ["lib/zod.js"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "zod", message: "Import { z } from lib/zod.js — it sets jitless so zod never trips the CSP." }] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
