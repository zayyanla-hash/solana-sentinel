"use client";

import React, { useEffect, useMemo, useState } from "react";
import { type OhlcvBar, type OhlcvInterval } from "@sat/shared";
import { usd } from "@/lib/utils";

interface MarketChartProps {
  mint: string;
  symbol: string;
  currentPrice: number | null;
  isDemoAsset?: boolean;
  apiToken?: string;
}

export function MarketChart({ mint, symbol, currentPrice, isDemoAsset = true, apiToken = "" }: MarketChartProps) {
  const [interval, setInterval] = useState<OhlcvInterval>("5m");
  const [chartType, setChartType] = useState<"candle" | "line">("candle");
  const [bars, setBars] = useState<OhlcvBar[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDemoData, setIsDemoData] = useState(true);
  const [hoverBar, setHoverBar] = useState<OhlcvBar | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/ohlcv?mint=${encodeURIComponent(mint)}&interval=${interval}&limit=60`, {
      headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data) => {
        if (!active) return;
        if (Array.isArray(data.bars)) {
          setBars(data.bars);
          setIsDemoData(Boolean(data.isDemo));
        }
      })
      .catch(() => {
        if (!active) return;
        setBars([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [mint, interval, apiToken]);

  // Dimensions
  const width = 680;
  const height = 240;
  const priceHeight = 180;
  const volHeight = 50;
  const padRight = 55;
  const padLeft = 8;
  const padTop = 15;
  const plotWidth = width - padLeft - padRight;

  const { minPrice, maxPrice, maxVol, priceTicks } = useMemo(() => {
    if (bars.length === 0) {
      const p = currentPrice ?? 1;
      return {
        minPrice: p * 0.98,
        maxPrice: p * 1.02,
        maxVol: 100,
        priceTicks: [p * 0.98, p, p * 1.02],
      };
    }
    let min = Infinity;
    let max = -Infinity;
    let maxV = 0;
    for (const b of bars) {
      if (b.low < min) min = b.low;
      if (b.high > max) max = b.high;
      if (b.volume > maxV) maxV = b.volume;
    }
    if (min === max) {
      min *= 0.98;
      max *= 1.02;
    }
    const range = max - min;
    const pad = range * 0.05;
    const finalMin = min - pad;
    const finalMax = max + pad;

    const ticks = [
      finalMax,
      finalMax - (finalMax - finalMin) * 0.33,
      finalMax - (finalMax - finalMin) * 0.66,
      finalMin,
    ];

    return { minPrice: finalMin, maxPrice: finalMax, maxVol: maxV || 1, priceTicks: ticks };
  }, [bars, currentPrice]);

  const candleData = useMemo(() => {
    if (bars.length === 0) return [];
    const count = bars.length;
    const step = plotWidth / count;
    const candleWidth = Math.max(2, Math.min(10, step * 0.7));

    return bars.map((b, i) => {
      const x = padLeft + i * step + step / 2;
      const openY = padTop + priceHeight - ((b.open - minPrice) / (maxPrice - minPrice || 1)) * priceHeight;
      const closeY = padTop + priceHeight - ((b.close - minPrice) / (maxPrice - minPrice || 1)) * priceHeight;
      const highY = padTop + priceHeight - ((b.high - minPrice) / (maxPrice - minPrice || 1)) * priceHeight;
      const lowY = padTop + priceHeight - ((b.low - minPrice) / (maxPrice - minPrice || 1)) * priceHeight;
      const isUp = b.close >= b.open;

      const vHeight = (b.volume / maxVol) * volHeight;
      const vY = height - vHeight;

      return {
        x,
        openY,
        closeY,
        highY,
        lowY,
        topY: Math.min(openY, closeY),
        bodyHeight: Math.max(1.5, Math.abs(closeY - openY)),
        isUp,
        candleWidth,
        vY,
        vHeight,
        bar: b,
      };
    });
  }, [bars, plotWidth, padLeft, padTop, priceHeight, minPrice, maxPrice, maxVol, height]);

  const linePath = useMemo(() => {
    if (candleData.length < 2) return "";
    return candleData.reduce(
      (acc, c, idx) => `${acc} ${idx === 0 ? "M" : "L"} ${c.x.toFixed(1)},${c.closeY.toFixed(1)}`,
      ""
    );
  }, [candleData]);

  const activeBar = hoverBar || (bars.length > 0 ? bars[bars.length - 1] : null);

  return (
    <div className="panel flex flex-col overflow-hidden">
      {/* Chart Toolbar */}
      <div className="px-3 py-1.5 border-b border-[#1b2636] bg-[#0c131d] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-white">{symbol}</span>
            <span className="text-[10px] text-[#64748b]">/USDC</span>
          </div>

          {/* Timeframe selector */}
          <div className="flex items-center bg-[#080d14] border border-[#1b2636] rounded-sm p-0.5">
            {(["1m", "5m", "15m", "1h", "4h"] as OhlcvInterval[]).map((iv) => (
              <button
                key={iv}
                onClick={() => setInterval(iv)}
                className={`px-1.5 py-0.2 text-[10px] rounded-sm cursor-pointer transition-colors ${
                  interval === iv
                    ? "bg-[#1e2d40] text-[#38bdf8] font-semibold"
                    : "text-[#64748b] hover:text-[#94a3b8]"
                }`}
              >
                {iv}
              </button>
            ))}
          </div>

          {/* Type Toggle */}
          <div className="flex items-center bg-[#080d14] border border-[#1b2636] rounded-sm p-0.5 text-[10px]">
            <button
              onClick={() => setChartType("candle")}
              className={`px-1.5 py-0.2 rounded-sm cursor-pointer ${
                chartType === "candle" ? "bg-[#1e2d40] text-[#38bdf8]" : "text-[#64748b]"
              }`}
            >
              Candles
            </button>
            <button
              onClick={() => setChartType("line")}
              className={`px-1.5 py-0.2 rounded-sm cursor-pointer ${
                chartType === "line" ? "bg-[#1e2d40] text-[#38bdf8]" : "text-[#64748b]"
              }`}
            >
              Line
            </button>
          </div>
        </div>

        {/* Real-time OHLCV inspection */}
        <div className="flex items-center gap-2 text-[10px] text-[#94a3b8]">
          {activeBar && (
            <>
              <span>O: <span className="text-white">{usd(activeBar.open, activeBar.open < 0.01 ? 5 : 2)}</span></span>
              <span>H: <span className="text-white">{usd(activeBar.high, activeBar.high < 0.01 ? 5 : 2)}</span></span>
              <span>L: <span className="text-white">{usd(activeBar.low, activeBar.low < 0.01 ? 5 : 2)}</span></span>
              <span>C: <span className={activeBar.close >= activeBar.open ? "text-emerald-400" : "text-rose-400"}>{usd(activeBar.close, activeBar.close < 0.01 ? 5 : 2)}</span></span>
              <span className="hidden md:inline">Vol: <span className="text-white">{activeBar.volume.toFixed(0)}</span></span>
            </>
          )}
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div className="relative bg-[#080d14] p-1 flex-1 select-none">
        {/* Data Honesty Watermark */}
        <div className="absolute top-2 right-16 pointer-events-none z-10 flex flex-col items-end">
          <span
            className={`text-[9px] font-mono px-1.5 py-0.2 tracking-wider rounded-sm font-semibold border ${
              isDemoData || isDemoAsset
                ? "bg-amber-950/40 text-amber-400/90 border-amber-800/40"
                : "bg-emerald-950/40 text-emerald-400/90 border-emerald-800/40"
            }`}
          >
            {isDemoData || isDemoAsset ? "DEMO / SYNTHETIC OHLCV" : "REAL BIRDEYE BARS"}
          </span>
          <span className="text-[9px] text-[#475569] font-mono mt-0.5">
            {isDemoData ? "Simulated historical path · Not live trades" : "Historical market closes"}
          </span>
        </div>

        {loading && (
          <div className="absolute inset-0 bg-[#080d14]/70 flex items-center justify-center z-20 font-mono text-xs text-[#64748b]">
            Loading bars…
          </div>
        )}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-48 md:h-56"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverBar(null)}
        >
          <defs>
            <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {priceTicks.map((pt, idx) => {
            const y = padTop + priceHeight - ((pt - minPrice) / (maxPrice - minPrice || 1)) * priceHeight;
            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#162130"
                  strokeDasharray="2 2"
                />
                <text
                  x={width - padRight + 6}
                  y={y + 3}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {pt < 0.01 ? pt.toFixed(6) : pt.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Volume separator line */}
          <line
            x1={padLeft}
            y1={height - volHeight}
            x2={width - padRight}
            y2={height - volHeight}
            stroke="#162130"
          />

          {/* Volume Bars */}
          {candleData.map((c, i) => (
            <rect
              key={`vol-${i}`}
              x={c.x - c.candleWidth / 2}
              y={c.vY}
              width={c.candleWidth}
              height={Math.max(1, c.vHeight)}
              fill={c.isUp ? "rgba(16, 185, 129, 0.25)" : "rgba(239, 68, 68, 0.25)"}
            />
          ))}

          {/* Price Candles or Line */}
          {chartType === "line" ? (
            <>
              <path
                d={`${linePath} L ${candleData[candleData.length - 1]?.x ?? 0},${padTop + priceHeight} L ${candleData[0]?.x ?? 0},${padTop + priceHeight} Z`}
                fill="url(#lineGrad)"
              />
              <path d={linePath} fill="none" stroke="#38bdf8" strokeWidth="1.5" />
            </>
          ) : (
            candleData.map((c, i) => (
              <g
                key={`candle-${i}`}
                className="cursor-crosshair"
                onMouseEnter={() => setHoverBar(c.bar)}
              >
                {/* Wick */}
                <line
                  x1={c.x}
                  y1={c.highY}
                  x2={c.x}
                  y2={c.lowY}
                  stroke={c.isUp ? "#10b981" : "#ef4444"}
                  strokeWidth="1"
                />
                {/* Body */}
                <rect
                  x={c.x - c.candleWidth / 2}
                  y={c.topY}
                  width={c.candleWidth}
                  height={c.bodyHeight}
                  fill={c.isUp ? "#10b981" : "#ef4444"}
                  stroke={c.isUp ? "#10b981" : "#ef4444"}
                  strokeWidth="0.5"
                />
              </g>
            ))
          )}

          {/* Crosshair indicator if hovering */}
          {hoverBar && (
            <line
              x1={candleData.find((c) => c.bar === hoverBar)?.x ?? 0}
              y1={padTop}
              x2={candleData.find((c) => c.bar === hoverBar)?.x ?? 0}
              y2={height}
              stroke="#38bdf8"
              strokeDasharray="2 2"
              strokeWidth="0.8"
            />
          )}
        </svg>
      </div>
    </div>
  );
}
