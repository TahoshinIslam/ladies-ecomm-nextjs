import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

// Pretty logs in dev, JSON logs in prod (for log aggregators).
const transport = isProd
  ? undefined
  : {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    };

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // Redact common secret-y fields from any logged object
  redact: {
    paths: [
      "password",
      "*.password",
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.token",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
  transport,
});

export default logger;
