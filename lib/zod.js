// @ts-check
/**
 * zod, configured once. Import `z` from here, never from "zod" directly.
 *
 * zod 4 speeds up object validation by compiling a parser with
 * `new Function(...)`, and probes whether that is allowed the first time it
 * parses. In the browser this site's Content-Security-Policy (proxy.js) forbids
 * eval on purpose — it is what keeps an injected script from running — so the
 * probe is blocked and reported as a CSP violation on every form page.
 * `jitless` makes zod use its ordinary interpreter instead and skip the probe:
 * the same validation, a little slower, and no hole in the policy.
 *
 * Set here, and every import goes through this module, so the setting is in
 * place before any schema parses — on the server and in the browser alike.
 */
import { z } from "zod";

z.config({ jitless: true });

export { z };
