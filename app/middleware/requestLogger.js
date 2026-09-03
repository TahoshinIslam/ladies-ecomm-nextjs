import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import logger from "../utils/logger.js";

// Attaches a unique request ID to every request, logs a line per request,
// and exposes req.log for use inside handlers.
const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = req.headers["x-request-id"] || randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  // Trim the noise — don't log health checks
  autoLogging: {
    ignore: (req) => req.url === "/api/health",
  },
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        userId: req.raw.user?._id?.toString(),
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});

export default requestLogger;
