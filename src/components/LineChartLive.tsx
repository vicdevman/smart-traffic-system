"use client";

import { useMemo, useRef, useState } from "react";

/**
 * Small live line chart, hand-built in SVG.
 *
 * Design rules applied here: a single y-axis (never two scales on one plot),
 * 2px marks, recessive grid, a legend plus direct end-of-line labels so series
 * identity never depends on colour alone, a crosshair tooltip, and a table
 * view for screen readers and for anyone who needs the numbers exactly.
 *
 * Series colours are the validated categorical slots 1 and 2 for a dark
 * surface; adjacent-pair CVD separation was checked rather than eyeballed.
 */

export interface Series {
  key: string;
  label: string;
  color: string;
}

export interface ChartPoint {
  t: number;
  [key: string]: number;
}

const PAD = { top: 14, right: 62, bottom: 24, left: 42 };
const VIEW_W = 720;
const VIEW_H = 240;

export function LineChartLive({
  data,
  series,
  yUnit = "",
  format = (v: number) => String(Math.round(v)),
  height = 240,
  emptyMessage = "Waiting for data...",
}: {
  data: ChartPoint[];
  series: Series[];
  yUnit?: string;
  format?: (value: number) => string;
  height?: number;
  emptyMessage?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ index: number; x: number } | null>(null);
  const [showTable, setShowTable] = useState(false);

  const geom = useMemo(() => {
    if (data.length === 0) return null;

    const xMin = data[0].t;
    const xMax = Math.max(data[data.length - 1].t, xMin + 1);

    let yMax = 0;
    for (const point of data) {
      for (const s of series) {
        const v = point[s.key];
        if (Number.isFinite(v) && v > yMax) yMax = v;
      }
    }
    yMax = niceCeil(yMax || 1);

    const plotW = VIEW_W - PAD.left - PAD.right;
    const plotH = VIEW_H - PAD.top - PAD.bottom;

    const sx = (t: number) => PAD.left + ((t - xMin) / (xMax - xMin)) * plotW;
    const sy = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

    const paths = series.map((s) => ({
      ...s,
      d: data
        .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.t).toFixed(1)},${sy(p[s.key] ?? 0).toFixed(1)}`)
        .join(" "),
      last: data[data.length - 1][s.key] ?? 0,
      lastY: sy(data[data.length - 1][s.key] ?? 0),
    }));

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      v: yMax * f,
      y: PAD.top + plotH - f * plotH,
    }));

    const xTicks = [0, 0.5, 1].map((f) => ({
      t: xMin + (xMax - xMin) * f,
      x: PAD.left + f * plotW,
    }));

    return { xMin, xMax, yMax, plotW, plotH, sx, sy, paths, ticks, xTicks };
  }, [data, series]);

  function handleMove(event: React.MouseEvent<HTMLDivElement>) {
    if (!geom || !wrapRef.current || data.length === 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    // Map the pointer through the viewBox scale.
    const vx = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    const ratio = (vx - PAD.left) / geom.plotW;
    const clamped = Math.max(0, Math.min(1, ratio));
    const index = Math.round(clamped * (data.length - 1));
    setHover({ index, x: geom.sx(data[index].t) });
  }

  if (!geom || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-[var(--color-line)] text-[11px] text-[var(--color-ink-faint)]"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    );
  }

  const hoverPoint = hover ? data[hover.index] : null;

  return (
    <div>
      {/* Legend - always present for two or more series. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {geom.paths.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px]">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            <span className="text-[var(--color-ink-dim)]">{s.label}</span>
            <span className="tnum font-medium text-[var(--color-ink)]">
              {format(s.last)}
              {yUnit}
            </span>
          </span>
        ))}
        <button
          onClick={() => setShowTable((v) => !v)}
          className="ml-auto text-[10px] text-[var(--color-ink-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-ink-dim)]"
        >
          {showTable ? "Hide table" : "Table view"}
        </button>
      </div>

      <div
        ref={wrapRef}
        className="relative"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height }}
          role="img"
          aria-label={`Line chart comparing ${series.map((s) => s.label).join(" and ")} over time`}
        >
          {/* Recessive grid. */}
          {geom.ticks.map((tick) => (
            <g key={tick.y}>
              <line
                x1={PAD.left}
                x2={VIEW_W - PAD.right}
                y1={tick.y}
                y2={tick.y}
                stroke="var(--color-line-soft)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 7}
                y={tick.y + 3}
                textAnchor="end"
                fontSize={9}
                fill="var(--color-ink-faint)"
                fontFamily="ui-monospace, monospace"
              >
                {format(tick.v)}
              </text>
            </g>
          ))}

          {geom.xTicks.map((tick) => (
            <text
              key={tick.x}
              x={tick.x}
              y={VIEW_H - 8}
              textAnchor="middle"
              fontSize={9}
              fill="var(--color-ink-faint)"
              fontFamily="ui-monospace, monospace"
            >
              {formatClock(tick.t)}
            </text>
          ))}

          {/* Crosshair sits under the marks so it never obscures them. */}
          {hover && (
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PAD.top}
              y2={PAD.top + geom.plotH}
              stroke="var(--color-ink-faint)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {geom.paths.map((s) => (
            <path
              key={s.key}
              d={s.d}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Direct end-of-line labels: identity without relying on colour. */}
          {geom.paths.map((s) => (
            <text
              key={`${s.key}-label`}
              x={VIEW_W - PAD.right + 6}
              y={clamp(s.lastY, PAD.top + 4, PAD.top + geom.plotH)}
              fontSize={9.5}
              fill={s.color}
              fontFamily="ui-monospace, monospace"
              dominantBaseline="middle"
            >
              {s.label.split(" ")[0]}
            </text>
          ))}

          {/* Hover markers, ringed in the surface colour to stay legible. */}
          {hover &&
            hoverPoint &&
            geom.paths.map((s) => (
              <circle
                key={`${s.key}-dot`}
                cx={hover.x}
                cy={geom.sy(hoverPoint[s.key] ?? 0)}
                r={4.5}
                fill={s.color}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            ))}
        </svg>

        {hover && hoverPoint && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-md border border-[var(--color-line)] bg-[var(--color-ground)] px-2.5 py-1.5 text-[10px] shadow-lg"
            style={{
              left: `${(hover.x / VIEW_W) * 100}%`,
              transform:
                hover.x > VIEW_W * 0.6 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
            }}
          >
            <p className="tnum mb-1 text-[var(--color-ink-faint)]">
              t = {formatClock(hoverPoint.t)}
            </p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[var(--color-ink-dim)]">{s.label}</span>
                <span className="tnum ml-auto pl-2 font-medium text-[var(--color-ink)]">
                  {format(hoverPoint[s.key] ?? 0)}
                  {yUnit}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>

      {showTable && (
        <div className="mt-3 max-h-44 overflow-auto rounded-md border border-[var(--color-line-soft)]">
          <table className="w-full text-left text-[10px]">
            <thead className="sticky top-0 bg-[var(--color-surface-2)]">
              <tr className="text-[var(--color-ink-faint)]">
                <th className="px-2 py-1 font-medium">Time</th>
                {series.map((s) => (
                  <th key={s.key} className="px-2 py-1 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tnum">
              {data
                .slice()
                .reverse()
                .slice(0, 60)
                .map((p) => (
                  <tr key={p.t} className="border-t border-[var(--color-line-soft)]">
                    <td className="px-2 py-0.5 text-[var(--color-ink-faint)]">
                      {formatClock(p.t)}
                    </td>
                    {series.map((s) => (
                      <td key={s.key} className="px-2 py-0.5 text-right text-[var(--color-ink-dim)]">
                        {format(p[s.key] ?? 0)}
                        {yUnit}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function niceCeil(value: number): number {
  if (value <= 5) return 5;
  const mag = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / mag) * mag;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
