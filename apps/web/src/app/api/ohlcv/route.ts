import { NextResponse } from "next/server";
import { createMarketDataProvider } from "@sat/market-data";
import { type OhlcvInterval } from "@sat/shared";
import { productionAuthDenied } from "@/lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_INTERVALS: OhlcvInterval[] = ["1m", "5m", "15m", "1h", "4h"];

export async function GET(req: Request) {
  const denied = productionAuthDenied(req);
  if (denied) return NextResponse.json({ error: denied.error, code: denied.code }, { status: denied.status });
  const { searchParams } = new URL(req.url);
  const mint = searchParams.get("mint");
  if (!mint) {
    return NextResponse.json({ error: "Missing mint parameter", code: "INVALID_PARAM" }, { status: 400 });
  }

  const rawInterval = searchParams.get("interval") ?? "5m";
  const interval: OhlcvInterval = VALID_INTERVALS.includes(rawInterval as OhlcvInterval)
    ? (rawInterval as OhlcvInterval)
    : "5m";

  const rawLimit = Number(searchParams.get("limit") ?? "60");
  const limit = Math.max(10, Math.min(180, isNaN(rawLimit) ? 60 : rawLimit));

  try {
    const market = createMarketDataProvider();
    const bars = await market.getOhlcv(mint, interval, limit);
    return NextResponse.json({
      mint,
      interval,
      limit,
      provider: market.name,
      isDemo: market.isDemo,
      bars,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch OHLCV", code: "FETCH_FAILED" },
      { status: 500 }
    );
  }
}
