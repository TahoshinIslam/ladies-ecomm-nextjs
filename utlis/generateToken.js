import jwt from "jsonwebtoken";

// Sign a JWT. Returned as a string to be included in the JSON response body
// (Bearer-token auth). We don't set a cookie because the frontend and backend
// are hosted on different domains (Vercel + Render) where third-party cookies
// are blocked by Safari/Chrome.
const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

export default generateToken;
