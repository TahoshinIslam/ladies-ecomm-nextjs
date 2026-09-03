import { getRedisClient, isRedisReady } from "../config/redis.js";
import logger from "./logger.js";

// Cache-aside helper. If Redis is unavailable, transparently falls through
// to the loader so the app keeps working — just without the speedup.
export const cached = async (key, ttlSeconds, loader) => {
  const client = getRedisClient();
  if (!isRedisReady() || !client) return loader();

  try {
    const hit = await client.get(key);
    if (hit) return JSON.parse(hit);
  } catch (err) {
    logger.warn({ err: err.message, key }, "cache read failed");
  }

  const value = await loader();
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (err) {
    logger.warn({ err: err.message, key }, "cache write failed");
  }
  return value;
};

// Invalidate every key matching a prefix. Uses SCAN so it never blocks Redis.
export const invalidatePrefix = async (prefix) => {
  const client = getRedisClient();
  if (!isRedisReady() || !client) return;

  try {
    for await (const key of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
      await client.del(key);
    }
  } catch (err) {
    logger.warn({ err: err.message, prefix }, "cache invalidate failed");
  }
};
