/**
 * Pure-SVG candlestick chart in TradingView style.
 *
 * Each candle tracks cumulative net balance (starting from 0 at the range
 * start): open = balance at period start, close = balance at period end,
 * high = max reachable balance (after positive transactions),
 * low = min reachable balance (after negative transactions).
 *
 * Bull candle (close ≥ open): hollow green body + green wicks
 * Bear candle (close < open): filled red body + red wicks
 */

import { useEffect, useRef, useState } from "react";
import type { CandleData } from "../types";

const BULL = "var(--green)";
const BEAR = "var(--red)";
const GRID = "var(--border)";
const TICK_COLOR = "var(--text-muted)";
const ZERO_LINE = "var(--text-secondary)";
const PAD = { top: 20, right: 72, bottom: 32, left: 4 };

function fmtY(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 10000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  if (abs >= 1000)  return `${sign}$${(abs / 1000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtXLabel(p: string, periodType: "day" | "month"): string {
  if (periodType === "month") {
    const [y, m] = p.split("-").map(Number);
    return new Date(y, m - 1).toLocaleString("en-US", { month: "short" });
  }
  const d = new Date(p + "T00:00:00");
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}

function fmtTooltipPeriod(p: string, periodType: "day" | "month"): string {
  if (periodType === "month") {
    const [y, m] = p.split("-").map(Number);
    return new Date(y, m - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  }
  const d = new Date(p + "T00:00:00");
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  data: CandleData[];
  height?: number;
  periodType?: "day" | "month";
}

export default function CandlestickChart({ data, height = 280, periodType = "day" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width || 800));
    ro.observe(el);
    setWidth(el.clientWidth || 800);
    return () => ro.disconnect();
  }, []);

  if (!data.length) {
    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
          No transaction data for this period
        </p>
      </div>
    );
  }

  const W = width;
  const H = height;
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Value range with padding — always include $0 as anchor
  let minVal = Math.min(...data.map((c) => c.low));
  let maxVal = Math.max(...data.map((c) => c.high));
  const valRange = maxVal - minVal || 100;
  minVal = Math.min(minVal - valRange * 0.06, 0);
  maxVal = Math.max(maxVal + valRange * 0.06, 0);
  const totalRange = maxVal - minVal;

  const toY = (v: number) => PAD.top + chartH * (1 - (v - minVal) / totalRange);
  const slotW = chartW / data.length;
  const toX = (i: number) => PAD.left + (i + 0.5) * slotW;
  const halfBody = Math.max(1.5, Math.min(slotW * 0.38, 18));

  // Y-axis ticks anchored at $0 with a nice step size
  const rough = totalRange / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rough || 1)));
  const norm = rough / mag;
  const step = norm < 1.5 ? mag : norm < 3 ? 2 * mag : norm < 7 ? 5 * mag : 10 * mag;
  const loTick = Math.ceil(minVal / step) * step;
  const hiTick = Math.floor(maxVal / step) * step;
  const yTicks: number[] = [];
  for (let v = loTick; v <= hiTick + step * 1e-6; v += step) {
    yTicks.push(Math.round(v / step) * step);
  }
  if (!yTicks.some((t) => t === 0)) yTicks.push(0);
  yTicks.sort((a, b) => a - b);

  // X-axis: evenly spaced labels
  const maxLabels = Math.max(2, Math.floor(chartW / 64));
  const xStep = Math.max(1, Math.ceil(data.length / maxLabels));

  // Tooltip data
  const hovered = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div ref={containerRef} style={{ width: "100%", height, position: "relative" }}>
      <svg
        width={W}
        height={H}
        style={{ display: "block" }}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const mx = e.clientX - rect.left - PAD.left;
          const idx = Math.floor(mx / slotW);
          setHoverIdx(idx >= 0 && idx < data.length ? idx : null);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Horizontal grid lines */}
        {yTicks.map((v, i) => (
          <line
            key={i}
            x1={PAD.left}
            y1={toY(v)}
            x2={W - PAD.right}
            y2={toY(v)}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}

        {/* Zero line */}
        {minVal < 0 && maxVal > 0 && (
          <line
            x1={PAD.left}
            y1={toY(0)}
            x2={W - PAD.right}
            y2={toY(0)}
            stroke={ZERO_LINE}
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        )}

        {/* Candles */}
        {data.map((c, i) => {
          const cx = toX(i);
          const yHigh = toY(c.high);
          const yLow = toY(c.low);
          const yOpen = toY(c.open);
          const yClose = toY(c.close);
          const isUp = c.close >= c.open;
          const color = isUp ? BULL : BEAR;
          const bodyTop = Math.min(yOpen, yClose);
          const bodyH = Math.max(Math.abs(yClose - yOpen), 1.5);

          return (
            <g
              key={i}
              opacity={hoverIdx !== null && hoverIdx !== i ? 0.45 : 1}
              style={{ transition: "opacity 0.1s" }}
            >
              {/* Wick */}
              <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={color} strokeWidth={1.5} />
              {/* Body */}
              <rect
                x={cx - halfBody}
                y={bodyTop}
                width={halfBody * 2}
                height={bodyH}
                fill={isUp ? "none" : color}
                stroke={color}
                strokeWidth={1.5}
              />
            </g>
          );
        })}

        {/* Crosshair vertical */}
        {hoverIdx !== null && (
          <line
            x1={toX(hoverIdx)}
            y1={PAD.top}
            x2={toX(hoverIdx)}
            y2={H - PAD.bottom}
            stroke="var(--border-strong)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}

        {/* Y-axis labels (right side) */}
        {yTicks.map((v, i) => (
          <text
            key={i}
            x={W - PAD.right + 6}
            y={toY(v) + 4}
            fill={TICK_COLOR}
            fontSize={10}
            fontFamily="ui-monospace, monospace"
          >
            {fmtY(v)}
          </text>
        ))}

        {/* X-axis labels */}
        {data.map((c, i) => {
          if (i % xStep !== 0) return null;
          return (
            <text
              key={i}
              x={toX(i)}
              y={H - PAD.bottom + 16}
              fill={TICK_COLOR}
              fontSize={10}
              textAnchor="middle"
            >
              {fmtXLabel(c.period, periodType)}
            </text>
          );
        })}

        {/* Axis border */}
        <line
          x1={PAD.left}
          y1={H - PAD.bottom}
          x2={W - PAD.right}
          y2={H - PAD.bottom}
          stroke="var(--border)"
          strokeWidth={1}
        />
      </svg>

      {/* Hover tooltip */}
      {hovered !== null && hoverIdx !== null && (
        <div
          style={{
            position: "absolute",
            top: PAD.top,
            left: (() => {
              const cx = PAD.left + (hoverIdx + 0.5) * slotW;
              return cx > W * 0.6 ? Math.max(0, cx - 168) : cx + 12;
            })(),
            background: "var(--surface)",
            border: `1px solid ${hovered.close >= hovered.open ? BULL : BEAR}55`,
            borderLeft: `3px solid ${hovered.close >= hovered.open ? BULL : BEAR}`,
            borderRadius: "var(--radius)",
            padding: "0.5rem 0.75rem",
            fontSize: "0.75rem",
            fontFamily: "var(--font-mono)",
            pointerEvents: "none",
            zIndex: 10,
            minWidth: 158,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          <p
            style={{
              fontWeight: 700,
              color: "var(--text-secondary)",
              marginBottom: "0.3rem",
              fontSize: "0.6875rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {fmtTooltipPeriod(hovered.period, periodType)}
          </p>
          {(
            [
              { label: "O", value: hovered.open },
              { label: "H", value: hovered.high },
              { label: "L", value: hovered.low },
              { label: "C", value: hovered.close },
            ] as { label: string; value: number }[]
          ).map(({ label, value }) => (
            <div
              key={label}
              style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", lineHeight: "1.6" }}
            >
              <span style={{ color: TICK_COLOR }}>{label}</span>
              <span style={{ color: value >= 0 ? BULL : BEAR }}>
                {value >= 0 ? "+" : ""}
                {Math.abs(value).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
          ))}
          <div
            style={{
              borderTop: "1px solid var(--border)",
              marginTop: "0.3rem",
              paddingTop: "0.3rem",
              display: "flex",
              justifyContent: "space-between",
              gap: "0.75rem",
            }}
          >
            <span style={{ color: TICK_COLOR }}>Vol</span>
            <span style={{ color: "var(--text-secondary)" }}>
              ${hovered.volume.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
