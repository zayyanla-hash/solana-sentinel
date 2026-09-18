import { NextResponse } from "next/server";
import { getDatabase } from "@sat/database";
import { getSystemHealth, getOperatingMode } from "@sat/pipeline";
import { isLiveTradingAllowed } from "@sat/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getSystemHealth(getDatabase());
  const status =
    health.healthStatus === "unavailable" ? 503 : health.healthStatus === "degraded" ? 200 : 200;
  return NextResponse.json(
    {
      ...health,
      operatingMode: getOperatingMode(),
      liveTradingAllowed: isLiveTradingAllowed(),
      canBroadcast: false,
    },
    { status },
  );
}
