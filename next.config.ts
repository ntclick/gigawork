import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  webpack(config) {
    // @privy-io/react-auth optionally imports this Farcaster package which isn't installed
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
    };
    // ox's tempo module uses a dynamic require() that webpack can't statically analyse
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /ox.*tempo.*virtualMasterPool/ },
    ];
    return config;
  },
};

export default nextConfig;
