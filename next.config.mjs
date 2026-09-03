import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // There is a stray package-lock.json in the parent directory, which makes
  // Turbopack infer the workspace root incorrectly. Pin it to this project.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
};

export default nextConfig;
