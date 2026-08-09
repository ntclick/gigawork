import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // reactCompiler: true, -- Disabled: React Compiler causes 'async Client Component' errors
  // in React 19 dev mode during HMR rebuilds due to trackUsedThenable conflicts.
  // Re-enable only after upgrading to a stable React Compiler + React 19 release.
  // Empty turbopack config tells Next.js 16 the webpack config is intentional.
  // The webpack function below still runs in --webpack / legacy builds.
  turbopack: {},
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
