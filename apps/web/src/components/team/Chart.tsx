"use client";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { buildPoints, chartSummary, isMarked, layoutChart, nearestIndex, sparklinePath, type ChartFilter, type ChartKind, type ChartPoint } from "./chart-data";
import { dayKey, formatClock, formatQty, formatTime, shortAddress } from "./format";
import type { Observation } from "./types";
import s from "./team.module.css";
import { cx } from "./ui";

const GO = "#00C805";
const STOP = "#FF5000";
const INK = "#F4F1EA";
const GROUND = "#0E0C09";
const GREY = "#8F897D";
const TOOLTIP_W = 232;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(Math.round(element.getBoundingClientRect().width) || 640);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.round(entry.contentRect.width) || 640));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function describe(point: ChartPoint) {
  const legs = point.item.trades.filter((t) => t.side === "BUY" || t.side === "SELL");
  const first = legs[0];
  const time = point.time ? formatClock(point.time * 1000) : null;
  return { time, legs, first };
}

function Tooltip({ point, x, width }: { point: ChartPoint; x: number; width: number }) {
  const { time, legs, first } = describe(point);
  const left = Math.min(Math.max(0, x - TOOLTIP_W / 2), Math.max(0, width - TOOLTIP_W));
  return (
    <div className={s.tooltip} style={{ left, width: TOOLTIP_W }}>
      <span className="text-xs text-[var(--t-muted)]">{time ? `${time} · ` : ""}Slot {point.slot.toLocaleString("en-US")}</span>
      {point.kind === "failed" ? (
        <span className="text-sm font-semibold"><span style={{ color: STOP }}>Failed</span> transaction</span>
      ) : first ? (
        <span className="text-sm font-semibold">
          <span style={{ color: first.side === "BUY" ? GO : STOP }}>{first.side}</span> {formatQty(first.qty)}{" "}
          <span className="mono text-xs">{shortAddress(first.mint)}</span>
          {legs.length > 1 && <span className="text-xs font-normal text-[var(--t-muted)]"> +{legs.length - 1} more</span>}
        </span>
      ) : (
        <span className="text-sm font-semibold">Unclassified</span>
      )}
      <span className="mono text-xs text-[var(--t-muted)]">{shortAddress(point.wallet)}</span>
    </div>
  );
}

function announce(point: ChartPoint) {
  const { time, first } = describe(point);
  const what = point.kind === "failed" ? "Failed transaction" : first ? `${first.side} ${formatQty(first.qty)} ${shortAddress(first.mint)}` : "Unclassified";
  return `${time ?? `Slot ${point.slot}`}. ${what}. Wallet ${shortAddress(point.wallet)}. Observation ${point.count}.`;
}

function markerColor(kind: ChartKind) {
  return kind === "buy" ? GO : kind === "sell" ? STOP : kind === "failed" ? STOP : GREY;
}

export function ObservationChart({ observations, filter, dim, label }: { observations: Observation[]; filter: ChartFilter; dim?: boolean; label: string }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const narrow = width < 520;
  const height = narrow ? 200 : 250;
  const points = useMemo(() => buildPoints(observations), [observations]);
  const layout = useMemo(() => layoutChart(points, width, height, { left: 8, right: 8, top: 72, bottom: 14 }), [points, width, height]);
  const safeActive = active !== null && active < points.length ? active : null;
  const activePoint = safeActive !== null ? points[safeActive] : undefined;

  function onPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const index = nearestIndex(layout.xs, event.clientX - rect.left);
    setActive(index >= 0 ? index : null);
  }
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!points.length) return;
    const last = points.length - 1;
    const at = safeActive ?? last;
    const next = event.key === "ArrowLeft" ? Math.max(0, at - 1) : event.key === "ArrowRight" ? Math.min(last, at + 1) : event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "Escape" ? null : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  }

  return (
    <div
      ref={ref}
      className={cx(s.chartWrap, dim && "opacity-45")}
      role="group"
      tabIndex={0}
      aria-label={`${label}. ${chartSummary(points)} Use the left and right arrow keys to step through observations.`}
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") setActive(null); }}
      onKeyDown={onKey}
      onFocus={(event) => { if (safeActive === null && points.length && event.currentTarget.matches(":focus-visible")) setActive(points.length - 1); }}
      onBlur={() => setActive(null)}
    >
      <svg className={s.chartSvg} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        <line x1={8} y1={layout.baseline} x2={width - 8} y2={layout.baseline} stroke="#3A342A" strokeWidth={1} strokeDasharray="2 5" />
        {layout.path && <path d={layout.path} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />}
        {points.map((point, i) => {
          if (!isMarked(point.kind, filter)) return null;
          const x = layout.xs[i]!;
          if (point.kind === "failed") {
            return <rect key={point.id} x={x - 3.5} y={layout.baseline - 3.5} width={7} height={7} fill={STOP} transform={`rotate(45 ${x} ${layout.baseline})`} />;
          }
          return <circle key={point.id} cx={x} cy={layout.ys[i]!} r={point.kind === "other" ? 3.6 : 5} fill={markerColor(point.kind)} stroke={GROUND} strokeWidth={2} />;
        })}
        {activePoint && safeActive !== null && (
          <>
            <line x1={layout.xs[safeActive]} y1={56} x2={layout.xs[safeActive]} y2={layout.baseline} stroke="#6E685D" strokeWidth={1} />
            <circle cx={layout.xs[safeActive]} cy={activePoint.kind === "failed" ? layout.baseline : layout.ys[safeActive]} r={7} fill="none" stroke={markerColor(activePoint.kind)} strokeWidth={2} />
          </>
        )}
      </svg>
      {activePoint && safeActive !== null && <Tooltip point={activePoint} x={layout.xs[safeActive]!} width={width} />}
      <span className={s.sr} role="status" aria-live="polite">{activePoint ? announce(activePoint) : ""}</span>
    </div>
  );
}

/** Axis caption under the chart: the oldest and newest observation in the window. */
export function chartRange(observations: Observation[]): { from: string; to: string } | null {
  const points = buildPoints(observations);
  if (!points.length) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first.time !== null && last.time !== null) {
    const todayKey = dayKey(new Date());
    const fmt = (t: number) => (dayKey(new Date(t * 1000)) === todayKey ? formatClock(t * 1000).slice(0, 5) : formatTime(t * 1000));
    return { from: `${fmt(first.time)} · oldest in window`, to: `${fmt(last.time)} · newest` };
  }
  return { from: `Slot ${first.slot.toLocaleString("en-US")} · oldest in window`, to: `Slot ${last.slot.toLocaleString("en-US")} · newest` };
}

export function ChartLegend() {
  const item = "inline-flex items-center gap-2";
  return (
    <div className={cx(s.soft, "flex flex-wrap gap-x-5 gap-y-2 text-[13px]")}>
      <span className={item}><span style={{ width: 16, height: 2, background: INK }} />Observations in window</span>
      <span className={item}><span style={{ width: 10, height: 10, borderRadius: 999, background: GO }} />Buy</span>
      <span className={item}><span style={{ width: 10, height: 10, borderRadius: 999, background: STOP }} />Sell</span>
      <span className={item}><span style={{ width: 8, height: 8, background: STOP, transform: "rotate(45deg)" }} />Failed</span>
      <span className={s.muted}>Unmarked steps are unclassified — the parser abstained, not proof of no trade.</span>
    </div>
  );
}

/** Per-wallet sparkline: the same cumulative step line, no axes. */
export function Sparkline({ observations, color, width = 96, height = 32 }: { observations: Observation[]; color: string; width?: number; height?: number }) {
  const path = useMemo(() => sparklinePath(observations, width, height), [observations, width, height]);
  if (!path) return <span aria-hidden="true" style={{ width, height }} />;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" />
    </svg>
  );
}
