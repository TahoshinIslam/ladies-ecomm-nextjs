// Wraps async controllers so errors flow to errorMiddleware instead of crashing the process
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
