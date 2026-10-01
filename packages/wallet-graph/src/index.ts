import {
  type WalletTrade,
  type WalletGraphEdge,
  type WalletCluster,
  type ClusterLabel,
  newId,
} from "@sat/shared";

export const WALLET_GRAPH_VERSION = "wallet-graph-v1";

export interface GraphInput {
  tradesByWallet: Record<string, WalletTrade[]>;
  isDemo?: boolean;
}

function hoursBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 3_600_000;
}

export function buildEdges(input: GraphInput): WalletGraphEdge[] {
  const wallets = Object.keys(input.tradesByWallet);
  const edges: WalletGraphEdge[] = [];
  const demo = Boolean(input.isDemo);

  for (const [wallet, trades] of Object.entries(input.tradesByWallet)) {
    for (const t of trades) {
      if (t.counterparty && t.counterparty !== wallet) {
        const kind = t.side === "TRANSFER_IN" || t.side === "TRANSFER_OUT" ? "TRANSFER" : "TRANSACTION";
        const labels: ClusterLabel[] =
          t.side === "TRANSFER_IN" || t.side === "TRANSFER_OUT" ? ["COMMON_FUNDER"] : ["RELATED_ACTIVITY"];
        edges.push({
          from: kind === "TRANSFER" && t.side === "TRANSFER_IN" ? t.counterparty : wallet,
          to: kind === "TRANSFER" && t.side === "TRANSFER_IN" ? wallet : t.counterparty,
          kind: kind === "TRANSFER" ? "TRANSFER" : "FUNDING",
          weight: t.usdNotional,
          confidence: 0.45,
          labels,
          evidence: [`${t.side} ${t.usdNotional.toFixed(0)} USD via ${t.signature.slice(0, 8)}`],
          isDemo: demo || t.isDemo,
        });
      }
    }
  }

  for (let i = 0; i < wallets.length; i++) {
    for (let j = i + 1; j < wallets.length; j++) {
      const a = wallets[i]!;
      const b = wallets[j]!;
      const ta = input.tradesByWallet[a] ?? [];
      const tb = input.tradesByWallet[b] ?? [];
      const buysA = ta.filter((t) => t.side === "BUY");
      const buysB = tb.filter((t) => t.side === "BUY");
      let co = 0;
      const evidence: string[] = [];
      for (const x of buysA) {
        for (const y of buysB) {
          if (x.mint === y.mint && hoursBetween(x.timestamp, y.timestamp) <= 2) {
            co += 1;
            if (evidence.length < 4) {
              evidence.push(`Both bought ${x.mint.slice(0, 6)}… within 2h`);
            }
          }
        }
      }
      if (co >= 2) {
        edges.push({
          from: a,
          to: b,
          kind: "CO_TRADE",
          weight: co,
          confidence: Math.min(0.85, 0.3 + co * 0.1),
          labels: ["COORDINATED_TIMING", "POSSIBLE_CLUSTER"],
          evidence,
          isDemo: demo,
        });
      }
      const setA = new Set(buysA.map((t) => t.mint));
      const setB = new Set(buysB.map((t) => t.mint));
      const shared = [...setA].filter((m) => setB.has(m));
      if (shared.length >= 2 && co < 2) {
        edges.push({
          from: a,
          to: b,
          kind: "CO_TRADE",
          weight: shared.length,
          confidence: 0.35,
          labels: ["RELATED_ACTIVITY"],
          evidence: [`Shared token basket size ${shared.length}`],
          isDemo: demo,
        });
      }
    }
  }
  return edges;
}

export function clusterWallets(edges: WalletGraphEdge[], isDemo = false): WalletCluster[] {
  const adj = new Map<string, Set<string>>();
  const labels = new Map<string, Set<ClusterLabel>>();
  const evidence = new Map<string, string[]>();
  for (const e of edges) {
    if (e.confidence < 0.3) continue;
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from)!.add(e.to);
    adj.get(e.to)!.add(e.from);
    for (const node of [e.from, e.to]) {
      if (!labels.has(node)) labels.set(node, new Set());
      for (const l of e.labels) labels.get(node)!.add(l);
      evidence.set(node, [...(evidence.get(node) ?? []), ...e.evidence]);
    }
  }
  const seen = new Set<string>();
  const clusters: WalletCluster[] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const group: string[] = [];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      group.push(n);
      for (const nxt of adj.get(n) ?? []) stack.push(nxt);
    }
    if (group.length < 2) continue;
    const labs = new Set<ClusterLabel>();
    const ev: string[] = [];
    for (const w of group) {
      for (const l of labels.get(w) ?? []) labs.add(l);
      ev.push(...(evidence.get(w) ?? []).slice(0, 2));
    }
    clusters.push({
      id: newId(),
      wallets: group.sort(),
      labels: [...labs],
      confidence: Math.min(0.8, 0.25 + group.length * 0.1),
      evidence: [...new Set(ev)].slice(0, 8),
      isDemo,
      ownershipClaimed: false,
    });
  }
  return clusters;
}

export function buildWalletGraph(input: GraphInput): {
  edges: WalletGraphEdge[];
  clusters: WalletCluster[];
  version: string;
} {
  const edges = buildEdges(input);
  return {
    edges,
    clusters: clusterWallets(edges, Boolean(input.isDemo)),
    version: WALLET_GRAPH_VERSION,
  };
}
