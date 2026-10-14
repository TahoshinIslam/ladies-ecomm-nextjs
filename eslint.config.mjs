import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // A name used but never imported or declared fails at runtime, not at build:
  // Next.js compiles it happily. Catch it here instead.
  { rules: { "no-undef": "error" } },
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
