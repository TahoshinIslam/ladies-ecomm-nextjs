// Node module customization hook implementation — see nextResolveHook.mjs
// for why this exists. Runs in the module customization hooks thread (per
// Node's `node:module` register() API), not the main test process.

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isBareNextSubpath = /^next\/[a-zA-Z0-9/_-]+$/.test(specifier) && !/\.[a-zA-Z]+$/.test(specifier);
    if (err?.code === "ERR_MODULE_NOT_FOUND" && isBareNextSubpath) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw err;
  }
}
