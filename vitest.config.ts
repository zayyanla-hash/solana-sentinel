import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@sat/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@sat/database": path.resolve(__dirname, "packages/database/src/index.ts"),
      "@sat/solana": path.resolve(__dirname, "packages/solana/src/index.ts"),
      "@sat/market-data": path.resolve(__dirname, "packages/market-data/src/index.ts"),
      "@sat/discovery": path.resolve(__dirname, "packages/discovery/src/index.ts"),
      "@sat/signals": path.resolve(__dirname, "packages/signals/src/index.ts"),
      "@sat/token-risk": path.resolve(__dirname, "packages/token-risk/src/index.ts"),
      "@sat/policy-engine": path.resolve(__dirname, "packages/policy-engine/src/index.ts"),
      "@sat/research-agent": path.resolve(__dirname, "packages/research-agent/src/index.ts"),
      "@sat/risk-engine": path.resolve(__dirname, "packages/risk-engine/src/index.ts"),
      "@sat/portfolio": path.resolve(__dirname, "packages/portfolio/src/index.ts"),
      "@sat/execution": path.resolve(__dirname, "packages/execution/src/index.ts"),
      "@sat/paper-trading": path.resolve(__dirname, "packages/paper-trading/src/index.ts"),
      "@sat/analytics": path.resolve(__dirname, "packages/analytics/src/index.ts"),
      "@sat/experiments": path.resolve(__dirname, "packages/experiments/src/index.ts"),
      "@sat/pipeline": path.resolve(__dirname, "packages/pipeline/src/index.ts"),
      "@sat/wallet-intel": path.resolve(__dirname, "packages/wallet-intel/src/index.ts"),
      "@sat/wallet-graph": path.resolve(__dirname, "packages/wallet-graph/src/index.ts"),
      "@sat/backtest": path.resolve(__dirname, "packages/backtest/src/index.ts"),
      "@sat/alerts": path.resolve(__dirname, "packages/alerts/src/index.ts"),
      "@sat/entitlements": path.resolve(__dirname, "packages/entitlements/src/index.ts"),
      "@sat/observability": path.resolve(__dirname, "packages/observability/src/index.ts"),
      "@sat/streaming": path.resolve(__dirname, "packages/streaming/src/index.ts"),
      "@sat/x402": path.resolve(__dirname, "packages/x402/src/index.ts"),
    },
  },
});
