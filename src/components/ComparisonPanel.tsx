"use client";

import type { HistoryPoint } from "@/hooks/useSimulation";
import type { SimSnapshot } from "@/lib/sim/types";
import { LineChartLive } from "./LineChartLive";
import { Card } from "./ui";

/**
 * The controlled experiment.
 *
 * Both engines are seeded identically and stepped in lockstep, so they receive
 * the same vehicles arriving at the same instants. The only difference between
 * them is the control strategy. That makes the numbers below a measurement of
 * the proposed system's benefit rather than an assertion about it - which is
 * exactly what section 5 of the report needs to stand on.
 */

/** Validated categorical slots 1 and 2 for a dark surface. */
export const SERIES_COLORS = {
  adaptive: "#3987e5",
  fixed: "#d95926",
} as const;

export function ComparisonPanel({
  adaptive,
  baseline,
  history,
}: {
  adaptive: SimSnapshot | null;
  baseline: SimSnapshot | null;
  history: HistoryPoint[];
}) {
  if (!adaptive || !baseline) return null;

  const a = adaptive.metrics;
  const f = baseline.metrics;

  const waitDelta = improvement(f.avgWaitTime, a.avgWaitTime);
  const queueDelta = improvement(f.totalQueue, a.totalQueue);
  const delayDelta = improvement(f.avgDelay, a.avgDelay);
  const stopsDelta = improvement(f.avgStops, a.avgStops);
  const throughputDelta = improvement(f.throughputPerHour, a.throughputPerHour, true);
  const fuelDelta = improvement(f.fuelWastedLitres, a.fuelWastedLitres);

  const idleA = pct(a.idleGreenSeconds, a.totalGreenSeconds);
  const idleF = pct(f.idleGreenSeconds, f.totalGreenSeconds);

  const warmingUp = adaptive.time < 60;

  return (
    <div className="space-y-4">
      <Card
        title="Adaptive vs fixed-timer: controlled comparison"
        subtitle="Both controllers receive an identical, seeded arrival stream. Any difference is caused by control strategy alone."
      >
        {/* Hero number - the single figure the whole project argues for. */}
        <div className="mb-4 rounded-lg border border-sky-500/25 bg-sky-500/[0.07] px-4 py-3.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
            Reduction in average waiting time
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span
              className={`tnum text-4xl font-semibold leading-none ${
                waitDelta >= 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"
              }`}
            >
              {waitDelta >= 0 ? "" : "+"}
              {Math.abs(waitDelta).toFixed(1)}%
            </span>
            <span className="text-[11px] text-[var(--color-ink-faint)]">
              {a.avgWaitTime.toFixed(1)}s adaptive vs {f.avgWaitTime.toFixed(1)}s fixed
            </span>
          </p>
          {warmingUp && (
            <p className="mt-2 text-[10px] leading-snug text-amber-300/90">
              Warming up - queues are still filling. Let the run reach roughly two minutes of
              simulated time before quoting this figure.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <CompareRow label="Avg wait / vehicle" adaptive={`${a.avgWaitTime.toFixed(1)}s`} fixed={`${f.avgWaitTime.toFixed(1)}s`} delta={waitDelta} />
          <CompareRow label="Avg control delay" adaptive={`${a.avgDelay.toFixed(1)}s`} fixed={`${f.avgDelay.toFixed(1)}s`} delta={delayDelta} />
          <CompareRow label="Queued now" adaptive={String(a.totalQueue)} fixed={String(f.totalQueue)} delta={queueDelta} />
          <CompareRow label="Stops / vehicle" adaptive={a.avgStops.toFixed(2)} fixed={f.avgStops.toFixed(2)} delta={stopsDelta} />
          <CompareRow label="Throughput" adaptive={`${Math.round(a.throughputPerHour)}/h`} fixed={`${Math.round(f.throughputPerHour)}/h`} delta={throughputDelta} />
          <CompareRow label="Idle green" adaptive={`${idleA.toFixed(1)}%`} fixed={`${idleF.toFixed(1)}%`} delta={improvement(idleF, idleA)} />
          <CompareRow label="Vehicles served" adaptive={String(a.vehiclesServed)} fixed={String(f.vehiclesServed)} delta={improvement(f.vehiclesServed, a.vehiclesServed, true)} />
          <CompareRow label="Idle fuel burned" adaptive={`${a.fuelWastedLitres.toFixed(2)}L`} fixed={`${f.fuelWastedLitres.toFixed(2)}L`} delta={fuelDelta} />
          <CompareRow
            label="Emergency response"
            adaptive={a.emergenciesServed ? `${a.avgEmergencyResponse.toFixed(1)}s` : "-"}
            fixed={f.emergenciesServed ? `${f.avgEmergencyResponse.toFixed(1)}s` : "-"}
            delta={
              a.emergenciesServed && f.emergenciesServed
                ? improvement(f.avgEmergencyResponse, a.avgEmergencyResponse)
                : null
            }
          />
        </div>
      </Card>

      <Card
        title="Total queue over time"
        subtitle="Vehicles standing at the intersection across all eight lanes."
      >
        <LineChartLive
          data={history.map((h) => ({
            t: h.t,
            adaptiveQueue: h.adaptiveQueue,
            fixedQueue: h.fixedQueue,
          }))}
          series={[
            { key: "adaptiveQueue", label: "Adaptive (proposed)", color: SERIES_COLORS.adaptive },
            { key: "fixedQueue", label: "Fixed timer (existing)", color: SERIES_COLORS.fixed },
          ]}
          yUnit=""
          emptyMessage="Run the simulation for a few seconds to build the series."
        />
      </Card>

      <Card
        title="Average waiting time over time"
        subtitle="Mean standstill seconds per vehicle that has cleared the junction."
      >
        <LineChartLive
          data={history.map((h) => ({
            t: h.t,
            adaptiveWait: h.adaptiveWait,
            fixedWait: h.fixedWait,
          }))}
          series={[
            { key: "adaptiveWait", label: "Adaptive (proposed)", color: SERIES_COLORS.adaptive },
            { key: "fixedWait", label: "Fixed timer (existing)", color: SERIES_COLORS.fixed },
          ]}
          yUnit="s"
          format={(v) => v.toFixed(1)}
          emptyMessage="Run the simulation for a few seconds to build the series."
        />
      </Card>
    </div>
  );
}

function CompareRow({
  label,
  adaptive,
  fixed,
  delta,
}: {
  label: string;
  adaptive: string;
  fixed: string;
  delta: number | null;
}) {
  return (
    <div className="card-tight px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">{label}</p>
      <div className="mt-1.5 space-y-0.5 text-[11px]">
        <p className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[var(--color-ink-dim)]">
            <span className="h-0.5 w-3 rounded-full" style={{ background: SERIES_COLORS.adaptive }} />
            Adaptive
          </span>
          <span className="tnum font-medium text-[var(--color-ink)]">{adaptive}</span>
        </p>
        <p className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[var(--color-ink-dim)]">
            <span className="h-0.5 w-3 rounded-full" style={{ background: SERIES_COLORS.fixed }} />
            Fixed
          </span>
          <span className="tnum text-[var(--color-ink-dim)]">{fixed}</span>
        </p>
      </div>
      {delta !== null && (
        <p
          className={`tnum mt-1.5 text-[10px] font-medium ${
            delta >= 0 ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"
          }`}
        >
          {delta >= 0 ? "▼" : "▲"} {Math.abs(delta).toFixed(1)}% {delta >= 0 ? "better" : "worse"}
        </p>
      )}
    </div>
  );
}

/**
 * Percentage improvement of `candidate` over `reference`.
 * Positive always means "the adaptive system did better".
 */
function improvement(reference: number, candidate: number, higherIsBetter = false): number {
  if (!Number.isFinite(reference) || reference === 0) return 0;
  const raw = ((reference - candidate) / reference) * 100;
  return higherIsBetter ? -raw : raw;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}
