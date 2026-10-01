import { NextResponse } from "next/server";
import { getDatabase } from "@sat/database";
import {
  runDiscoveryCycle,
  runFullResearchPass,
  evaluateMint,
  executePaperProposal,
  runDemoExperiment,
  getSystemHealth,
  getOperatingMode,
  markToMarket,
  runStrategyLab,
  createAlertRule,
  analyzeWallet,
  generateSmartMoneySignals,
  listWalletIntelligence,
  addWatchlistItem,
  removeWatchlistItem,
  portfolioRiskSnapshot,
} from "@sat/pipeline";
import { ActionSchema, isMonitorOnly, mutatingRequestDenied, productionAuthDenied } from "@/lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

export async function GET(req: Request) {
  const denied = productionAuthDenied(req, true);
  if (denied) return NextResponse.json({ error: denied.error, code: denied.code }, { status: denied.status });
  const db = getDatabase();
  const state = await db.getState();
  return NextResponse.json({
    ...state,
    health: await getSystemHealth(db),
    operatingMode: getOperatingMode(),
    monitorOnly: isMonitorOnly(),
    wallets: state.walletScores,
    sentinelSignals: state.sentinelSignals,
    alertRules: state.alertRules,
    alertEvents: state.alertEvents,
    portfolioRisk: await portfolioRiskSnapshot(db),
  });
}

export async function POST(req: Request) {
  const productionDenied = productionAuthDenied(req, true);
  if (productionDenied) return NextResponse.json(productionDenied, { status: productionDenied.status });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError("Invalid JSON", "INVALID_JSON", 400);
  }
  const parsed = ActionSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid action", "INVALID_ACTION", 400);
  }
  const body = parsed.data;
  const denied = mutatingRequestDenied(req, body.action);
  if (denied) {
    const status = denied.code === "AUTH_UNAVAILABLE" ? 503
      : denied.code === "UNAUTHORIZED" || denied.code === "AUTH_REQUIRED" ? 401 : 403;
    return NextResponse.json(denied, { status });
  }
  const db = getDatabase();

  try {
    switch (body.action) {
      case "discover":
        return NextResponse.json(await runDiscoveryCycle(db));
      case "research_pass":
        return NextResponse.json({
          proposals: await runFullResearchPass(db),
          health: await getSystemHealth(db),
        });
      case "bootstrap": {
        const state = await db.getState();
        if (state.candidates.length === 0) {
          await runFullResearchPass(db);
        }
        if ((await db.getState()).experiments.length === 0) await runDemoExperiment(db);
        return NextResponse.json({
          ...(await db.getState()),
          health: await getSystemHealth(db),
          operatingMode: getOperatingMode(),
          wallets: await listWalletIntelligence(db),
          sentinelSignals: await generateSmartMoneySignals(db).catch(() => []),
          portfolioRisk: await portfolioRiskSnapshot(db),
        });
      }
      case "evaluate":
        return NextResponse.json({ proposal: await evaluateMint(body.mint, db) });
      case "paper_execute":
        try {
          const result = await executePaperProposal(body.proposalId, db);
          return NextResponse.json(result);
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e), "EXECUTE_FAILED", 400);
        }
      case "experiment":
        return NextResponse.json({ experiment: await runDemoExperiment(db) });
      case "mark":
        return NextResponse.json({ portfolio: await markToMarket(db) });
      case "backtest":
        return NextResponse.json({
          backtest: await runStrategyLab({
            mint: "mint" in body ? body.mint : undefined,
            walkForward: "walkForward" in body ? body.walkForward : true,
            db,
          }),
        });
      case "alert_create":
        return NextResponse.json({
          rule: await createAlertRule({
            name: body.name,
            trigger: body.trigger,
            threshold: body.threshold ?? null,
          }),
        });
      case "wallet_analyze":
        return NextResponse.json({ score: await analyzeWallet(body.address, db) });
      case "watchlist_add":
        return NextResponse.json({
          item: await addWatchlistItem({
            kind: body.kind,
            address: body.address,
            db,
          }),
        });
      case "watchlist_remove":
        await removeWatchlistItem(body.id, db);
        return NextResponse.json({ ok: true });
      case "reset":
        await db.reset(Number(process.env.PAPER_STARTING_CAPITAL_USD ?? 100_000));
        await runFullResearchPass(db);
        await runDemoExperiment(db);
        return NextResponse.json(await db.getState());
      default:
        return jsonError("unknown action", "UNKNOWN_ACTION", 400);
    }
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), "INTERNAL", 500);
  }
}
