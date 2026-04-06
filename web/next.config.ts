import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // CSP removed — Privy SDK needs unrestricted fetch to auth.privy.io
  // In production, add CSP via reverse proxy (nginx/cloudflare) instead.
};

export default nextConfig;
