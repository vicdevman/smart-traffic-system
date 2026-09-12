"use client";

import { useCallback, useEffect, useState } from "react";
import { LineChartLive } from "@/components/LineChartLive";
import { Badge, Button, Card, StatTile } from "@/components/ui";
import { SERIES_COLORS } from "@/components/ComparisonPanel";

/**
 * Planning analytics.
 *
 * Everything on this page is read back out of the database through the public
 * API - nothing is computed in the browser from live simulation state. That is
 * deliberate: it proves the telemetry pipeline actually persisted the data and
 * that the reporting endpoint works against stored records, which is what a
 * planning department would rely on.
 */

interface SummaryResponse {
  ok: boolean;
  intersectionId: string;
  samples: number;
  message?: string;
  window?: { from: string; to: string };
  headline?: {
    avgWaitTime: number;
    avgQueue: number;
    avgThroughputPerHour: number;
    avgIdleGreenPct: number;
    vehiclesServed: number;
  };
  peak?: { totalQueue: number; occurredAt: string; phaseAtPeak: string };
  busiestHour?: { hour: number; avgQueue: number; samples: number } | null;
  approachLoad?: Array<{ approach: string; avgQueue: number; peakWait: number }>;
  emergency?: { preemptions: number; avgResponseSeconds: number };
  incidentsByType?: Record<string, number>;
  recommendations?: string[];
}

interface TelemetryResponse {
  ok: boolean;
  logs: Array<{
    recordedAt: string;
    simTime: number;
    metrics: { avgWaitTime: number; totalQueue: number; vehiclesServed: number };
  }>;
}

const INTERSECTIONS = ["INT-001", "INT-002", "INT-003"];

export default function AnalyticsPage() {
  const [intersectionId, setIntersectionId] = useState("INT-001");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [series, setSeries] = useState<TelemetryResponse["logs"]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, telemetryRes] = await Promise.all([
        fetch(`/api/reports/summary?intersectionId=${intersectionId}`, { cache: "no-store" }),
        fetch(`/api/telemetry?intersectionId=${intersectionId}&limit=240`, { cache: "no-store" }),
      ]);
      setSummary(await summaryRes.json());
      const telemetry = (await telemetryRes.json()) as TelemetryResponse;
      setSeries(telemetry.logs ?? []);
    } catch {
      setSummary(null);
      setSeries([]);
    } finally {
      setLoading(false);
    }
  }, [intersectionId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const chartData = series.map((log, index) => ({
    t: index,
    queue: log.metrics.totalQueue,
    wait: Number(log.metrics.avgWaitTime.toFixed(2)),
  }));

  const hasData = (summary?.samples ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold tracking-tight">Planning Analytics</h1>
        {INTERSECTIONS.map((id) => (
          <button
            key={id}
            onClick={() => setIntersectionId(id)}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              intersectionId === id
                ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                : "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            }`}
          >
            {id}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {loading && <Badge tone="accent" pulse>Loading</Badge>}
          <Button onClick={load}>Refresh</Button>
        </div>
      </div>

      <p className="max-w-3xl text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        Read back from stored telemetry through{" "}
        <code className="rounded bg-[var(--color-surface-2)] px-1">/api/reports/summary</code>. Leave
        the control room running in another tab to accumulate samples, or run{" "}
        <code className="rounded bg-[var(--color-surface-2)] px-1">npm run virtual-edge</code> to feed
        the API from a headless controller.
      </p>

      {!hasData ? (
        <Card title="No telemetry recorded yet">
          <p className="text-xs leading-relaxed text-[var(--color-ink-dim)]">
            {summary?.message ??
              "Nothing has been uploaded for this intersection yet. Open the Control Room and let the simulation run for a minute, then come back."}
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Samples" value={summary!.samples} />
            <StatTile
              label="Avg wait"
              value={summary!.headline!.avgWaitTime.toFixed(1)}
              unit="s"
              tone="accent"
            />
            <StatTile label="Avg queue" value={summary!.headline!.avgQueue.toFixed(1)} />
            <StatTile
              label="Throughput"
              value={Math.round(summary!.headline!.avgThroughputPerHour)}
              unit="veh/h"
            />
            <StatTile
              label="Idle green"
              value={summary!.headline!.avgIdleGreenPct.toFixed(1)}
              unit="%"
              tone={summary!.headline!.avgIdleGreenPct > 15 ? "warn" : "good"}
            />
            <StatTile label="Served" value={summary!.headline!.vehiclesServed} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Queue history"
              subtitle="Total vehicles queued, from stored telemetry samples."
            >
              <LineChartLive
                data={chartData.map((d) => ({ t: d.t, queue: d.queue }))}
                series={[{ key: "queue", label: "Total queue", color: SERIES_COLORS.adaptive }]}
                emptyMessage="Not enough samples yet."
              />
            </Card>

            <Card title="Waiting time history" subtitle="Mean standstill seconds per vehicle.">
              <LineChartLive
                data={chartData.map((d) => ({ t: d.t, wait: d.wait }))}
                series={[{ key: "wait", label: "Avg wait", color: SERIES_COLORS.fixed }]}
                yUnit="s"
                format={(v) => v.toFixed(1)}
                emptyMessage="Not enough samples yet."
              />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Approach loading"
              subtitle="Mean queue by approach - identifies the dominant corridor."
            >
              <div className="space-y-2.5">
                {summary!.approachLoad?.map((row) => {
                  const max = Math.max(...summary!.approachLoad!.map((r) => r.avgQueue), 1);
                  return (
                    <div key={row.approach}>
                      <div className="mb-1 flex items-baseline justify-between text-[11px]">
                        <span className="text-[var(--color-ink-dim)]">
                          {row.approach} approach
                        </span>
                        <span className="tnum text-[var(--color-ink-faint)]">
                          avg {row.avgQueue} · peak wait {row.peakWait}s
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(row.avgQueue / max) * 100}%`,
                            background: SERIES_COLORS.adaptive,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Peak and incidents" subtitle="What the audit trail recorded.">
              <dl className="space-y-1.5 text-[11px]">
                <Row label="Peak total queue" value={String(summary!.peak?.totalQueue ?? "-")} />
                <Row
                  label="Peak occurred"
                  value={
                    summary!.peak?.occurredAt
                      ? new Date(summary!.peak.occurredAt).toLocaleTimeString()
                      : "-"
                  }
                />
                <Row label="Phase at peak" value={summary!.peak?.phaseAtPeak ?? "-"} />
                <Row
                  label="Busiest clock hour"
                  value={
                    summary!.busiestHour
                      ? `${String(summary!.busiestHour.hour).padStart(2, "0")}:00 (avg queue ${summary!.busiestHour.avgQueue})`
                      : "-"
                  }
                />
                <Row
                  label="Emergency preemptions"
                  value={String(summary!.emergency?.preemptions ?? 0)}
                />
                <Row
                  label="Avg emergency response"
                  value={`${summary!.emergency?.avgResponseSeconds ?? 0}s`}
                />
              </dl>

              {summary!.incidentsByType &&
                Object.keys(summary!.incidentsByType).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(summary!.incidentsByType).map(([type, count]) => (
                      <Badge key={type} tone={type.includes("emergency") ? "bad" : "neutral"}>
                        {type.replace(/_/g, " ")} · {count}
                      </Badge>
                    ))}
                  </div>
                )}
            </Card>
          </div>

          {summary!.recommendations && summary!.recommendations.length > 0 && (
            <Card
              title="Automated planning recommendations"
              subtitle="Generated from the aggregates above."
            >
              <ul className="space-y-2">
                {summary!.recommendations.map((rec) => (
                  <li
                    key={rec}
                    className="flex gap-2.5 text-[11px] leading-relaxed text-[var(--color-ink-dim)]"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="tnum text-[var(--color-ink-dim)]">{value}</dd>
    </div>
  );
}
