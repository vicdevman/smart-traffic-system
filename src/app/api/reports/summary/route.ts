import { NextResponse } from "next/server";
import { getTrafficLogs, listIncidents } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/summary?intersectionId=INT-001&limit=500
 *
 * Planning report. Aggregates the stored telemetry into the outputs a city
 * planning department actually asks for: mean and peak queue, when the peak
 * occurred, how loaded each approach is relative to the others, how much green
 * time was wasted, and the emergency response record.
 *
 * This is the reporting capability promised in section 3.6 ("Data-Driven:
 * generates reports on traffic peak times for city planning").
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const intersectionId = searchParams.get("intersectionId") ?? "INT-001";
  const limitRaw = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(10, limitRaw)) : 500;

  const [logs, incidents] = await Promise.all([
    getTrafficLogs(intersectionId, limit),
    listIncidents(intersectionId, 100),
  ]);

  if (logs.length === 0) {
    return NextResponse.json({
      ok: true,
      intersectionId,
      samples: 0,
      message:
        "No telemetry recorded yet. Start the simulator on the dashboard, or run `npm run virtual-edge`.",
    });
  }

  // --- headline averages ---------------------------------------------------
  const avg = (pick: (l: (typeof logs)[number]) => number) =>
    logs.reduce((s, l) => s + pick(l), 0) / logs.length;

  const peakSample = logs.reduce((worst, l) =>
    l.metrics.totalQueue > worst.metrics.totalQueue ? l : worst,
  );

  // --- per-approach loading ------------------------------------------------
  const approachTotals: Record<string, { queue: number; count: number; maxWait: number }> = {};
  for (const log of logs) {
    for (const lane of log.lanes) {
      const bucket = (approachTotals[lane.approach] ??= { queue: 0, count: 0, maxWait: 0 });
      bucket.queue += lane.queueLength;
      bucket.count += 1;
      bucket.maxWait = Math.max(bucket.maxWait, lane.maxWait);
    }
  }

  const approachLoad = Object.entries(approachTotals)
    .map(([approach, b]) => ({
      approach,
      avgQueue: round(b.queue / Math.max(1, b.count), 2),
      peakWait: round(b.maxWait, 1),
    }))
    .sort((a, b) => b.avgQueue - a.avgQueue);

  // --- demand profile by clock hour ---------------------------------------
  const hourly: Record<number, { queue: number; count: number }> = {};
  for (const log of logs) {
    const hour = new Date(log.recordedAt).getHours();
    const bucket = (hourly[hour] ??= { queue: 0, count: 0 });
    bucket.queue += log.metrics.totalQueue;
    bucket.count += 1;
  }
  const hourlyProfile = Object.entries(hourly)
    .map(([hour, b]) => ({
      hour: Number(hour),
      avgQueue: round(b.queue / b.count, 2),
      samples: b.count,
    }))
    .sort((a, b) => a.hour - b.hour);

  const busiestHour = hourlyProfile.reduce(
    (worst, h) => (h.avgQueue > worst.avgQueue ? h : worst),
    hourlyProfile[0],
  );

  // --- emergency performance ----------------------------------------------
  const preemptions = incidents.filter((i) => i.type === "emergency_preemption");
  const avgResponse = preemptions.length
    ? preemptions.reduce((s, i) => s + i.responseSeconds, 0) / preemptions.length
    : 0;

  const window = {
    from: logs[0].recordedAt,
    to: logs[logs.length - 1].recordedAt,
  };

  const fellBack = logs.some((l) => l.intersectionId !== intersectionId);

  return NextResponse.json({
    ok: true,
    intersectionId,
    samples: logs.length,
    note: fellBack
      ? `No telemetry recorded yet for ${intersectionId} - showing the most recent samples from whichever intersection last ran a simulation.`
      : undefined,
    window,
    headline: {
      avgWaitTime: round(avg((l) => l.metrics.avgWaitTime), 2),
      avgQueue: round(avg((l) => l.metrics.totalQueue), 2),
      avgThroughputPerHour: round(avg((l) => l.metrics.throughputPerHour), 0),
      avgIdleGreenPct: round(avg((l) => l.metrics.idleGreenPct), 1),
      vehiclesServed: logs[logs.length - 1].metrics.vehiclesServed,
    },
    peak: {
      totalQueue: peakSample.metrics.totalQueue,
      occurredAt: peakSample.recordedAt,
      phaseAtPeak: peakSample.currentPhase,
    },
    busiestHour: busiestHour ?? null,
    approachLoad,
    hourlyProfile,
    emergency: {
      preemptions: preemptions.length,
      avgResponseSeconds: round(avgResponse, 1),
    },
    incidentsByType: countBy(incidents, (i) => i.type),
    recommendations: buildRecommendations(
      round(avg((l) => l.metrics.idleGreenPct), 1),
      approachLoad,
    ),
  });
}

function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const k = key(item);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * Turns the aggregates into plain-language advice. A planning report that only
 * emits numbers leaves the interpretation to the reader; this closes that gap.
 */
function buildRecommendations(
  idleGreenPct: number,
  approachLoad: Array<{ approach: string; avgQueue: number }>,
): string[] {
  const out: string[] = [];

  if (idleGreenPct > 15) {
    out.push(
      `Idle green time is ${idleGreenPct}% of all green displayed. Shortening the minimum green or tightening the gap-out threshold would recover most of it.`,
    );
  } else {
    out.push(
      `Idle green time is ${idleGreenPct}%, within the 15% target for a demand-responsive plan.`,
    );
  }

  if (approachLoad.length >= 2) {
    const heaviest = approachLoad[0];
    const lightest = approachLoad[approachLoad.length - 1];
    const ratio = heaviest.avgQueue / Math.max(0.1, lightest.avgQueue);
    if (ratio > 2.5) {
      out.push(
        `The ${heaviest.approach} approach carries ${ratio.toFixed(1)}x the queue of the ${lightest.approach} approach. This junction is a candidate for a dedicated lane or a coordinated green wave along that corridor.`,
      );
    } else {
      out.push(
        `Approach loading is reasonably balanced (heaviest/lightest ratio ${ratio.toFixed(1)}x); no geometric change is indicated by this data.`,
      );
    }
  }

  return out;
}
