import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() { return [{ source: "/:path*", headers: [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
  ] }]; },
  transpilePackages: [
    "@sat/shared",
    "@sat/database",
    "@sat/pipeline",
    "@sat/market-data",
    "@sat/solana",
    "@sat/discovery",
    "@sat/signals",
    "@sat/token-risk",
    "@sat/policy-engine",
    "@sat/research-agent",
    "@sat/risk-engine",
    "@sat/portfolio",
    "@sat/execution",
    "@sat/paper-trading",
    "@sat/analytics",
    "@sat/experiments",
  ],
};

export default nextConfig;
