import { createClient } from "redis";
import logger from "../utils/logger.js";

let client = null;
let ready = false;

export const getRedisClient = () => client;
export const isRedisReady = () => ready;

/**
 * Connect to Redis. Resolves even if connection fails — the app falls back
 * to in-memory stores in that case, logged loudly but not crashing.
 */
export const connectRedis = async () => {
  if (!process.env.REDIS_URL) {
    logger.warn(
      "REDIS_URL not set — rate limiting will use in-memory store (not safe for multi-instance deployments)",
    );
    return null;
  }

  try {
    client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        // Don't retry forever — if Redis is down, fail fast and use the fallback
        reconnectStrategy: (retries) => {
          if (retries > 5) {
            logger.error("Redis: giving up after 5 reconnect attempts");
            return new Error("Redis reconnect limit reached");
          }
          return Math.min(retries * 200, 2000);
        },
      },
    });

    client.on("error", (err) => {
      // Log at warn level — "error" from the redis client is extremely noisy
      // on transient disconnects and we don't want it spamming Sentry.
      logger.warn({ err: err.message }, "Redis client error");
      ready = false;
    });

    client.on("ready", () => {
      ready = true;
      logger.info("Redis connected");
    });

    client.on("end", () => {
      ready = false;
      logger.warn("Redis connection closed");
    });

    await client.connect();
    return client;
  } catch (err) {
    logger.error(
      { err },
      "Redis connection failed — falling back to in-memory store",
    );
    client = null;
    ready = false;
    return null;
  }
};
