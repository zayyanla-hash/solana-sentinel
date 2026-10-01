"use client";
import { useMemo, useState } from "react";
import { classify } from "./chart";
import { groupByDay } from "./derive";
import { formatClock, formatQty, shortAddress } from "./format";
import { Icon, type IconName } from "./icons";
import { presentActivityOutcome } from "./status";
import type { Observation } from "./types";
import s from "./team.module.css";
import { Button, StatusPill, TONE_COLOR, cx } from "./ui";

const PAGE = 10;

function rowIcon(item: Observation["item"]): { name: IconName; color: string } {
  switch (classify(item)) {
    case "buy": return { name: "up", color: TONE_COLOR.ok };
    case "sell": return { name: "down", color: TONE_COLOR.bad };
    case "failed": return { name: "alert", color: TONE_COLOR.bad };
    default: return { name: "dot", color: "#8F897D" };
  }
}

function Row({ entry, showWallet, onOpenWallet }: { entry: Observation; showWallet: boolean; onOpenWallet?: (wallet: string) => void }) {
  const { item, wallet } = entry;
  const outcome = presentActivityOutcome(item.outcome);
  const icon = rowIcon(item);
  const legs = item.trades.filter((t) => t.side === "BUY" || t.side === "SELL");
  const title = legs.length ? null : item.outcome === "FAILED" ? item.reason || "Transaction failed on chain" : item.reason || "Unclassified";
  const time = item.blockTime ? formatClock(item.blockTime * 1000).slice(0, 5) : null;
  return (
    <li className={s.row}>
      <span className="flex min-w-0 items-center gap-3.5">
        <span className={s.iconCircle}><Icon name={icon.name} color={icon.color} /></span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="min-w-0 font-semibold break-words">
            {title ?? legs.map((leg, i) => (
              <span key={i} className="mr-2 inline-block">
                {leg.side} {formatQty(leg.qty)} <span className={cx(s.mono, s.muted, "text-[13px] font-normal")} title={leg.mint}>{shortAddress(leg.mint)}</span>
              </span>
            ))}
          </span>
          <span className={cx(s.muted, "text-[13px]")}>
            {showWallet && (
              onOpenWallet
                ? <button type="button" onClick={() => onOpenWallet(wallet)} title={wallet} aria-label={`Open wallet ${wallet}`} className={cx(s.mono, "border-0 bg-transparent p-0 text-inherit underline decoration-[var(--t-hair2)] underline-offset-2 hover:text-[var(--t-ink)]")}>{shortAddress(wallet)}</button>
                : <span className={s.mono} title={wallet}>{shortAddress(wallet)}</span>
            )}
            {showWallet && " · "}Slot {item.slot.toLocaleString("en-US")}{time ? ` · ${time}` : ""}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <StatusPill presented={outcome} />
        <a href={`https://explorer.solana.com/tx/${item.signature}`} target="_blank" rel="noreferrer" aria-label={`Open transaction ${shortAddress(item.signature, 6, 6)} in Solana Explorer (new tab)`} title="Open in Solana Explorer" className={cx(s.muted, "inline-flex size-11 items-center justify-center")}>
          <Icon name="ext" />
        </a>
      </span>
    </li>
  );
}

/** Observations grouped by local day. Input is newest first. */
export function ActivityList({ items, showWallet = false, onOpenWallet, pageSize = PAGE }: { items: Observation[]; showWallet?: boolean; onOpenWallet?: (wallet: string) => void; pageSize?: number }) {
  const [shown, setShown] = useState(pageSize);
  const visible = items.slice(0, shown);
  const groups = useMemo(() => groupByDay(visible), [visible]);
  return (
    <div>
      {groups.map((group, index) => (
        <div key={`${group.key}:${index}`}>
          <h3 className={cx(s.eyebrow, "border-b border-[var(--t-hair)] pt-6 pb-2")}>{group.label}</h3>
          <ul>{group.items.map((entry) => <Row key={`${entry.wallet}:${entry.item.signature}`} entry={entry} showWallet={showWallet} onOpenWallet={onOpenWallet} />)}</ul>
        </div>
      ))}
      {items.length > shown && (
        <div className="pt-4">
          <Button small onClick={() => setShown((n) => n + pageSize)}>Show more ({items.length - shown} older)</Button>
        </div>
      )}
    </div>
  );
}
