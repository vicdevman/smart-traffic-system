import {
  insertTrafficLogs,
  markIntersectionSeen,
  type TrafficLogRecord,
} from "@/lib/db/repository";

/**
 * Telemetry validation and ingestion, shared by the two entry points:
 *
 *   /api/telemetry       - the public device endpoint, authenticated with a
 *                          device key. This is what a real Raspberry Pi posts
 *                          to over the internet.
 *
 *   /api/edge/telemetry  - the same-origin bridge used by the in-browser edge
 *                          simulator. The browser cannot hold the device
 *                          secret, so this route stands in for a provisioned
 *                          device during a demo. It performs identical
 *                          validation and writes to the identical store.
 */

export interface IngestResult {
  accepted: number;
  rejected: number;
  problems: string[];
}

export function extractBatch(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (typeof body === "object" && body !== null && "batch" in body) {
    const batch = (body as { batch: unknown }).batch;
    return Array.isArray(batch) ? batch : [];
  }
  return [body];
}

export async function ingestTelemetry(raw: unknown[]): Promise<IngestResult> {
  const problems: string[] = [];
  const records: TrafficLogRecord[] = [];

  raw.forEach((entry, index) => {
    const parsed = normaliseTelemetry(entry, index, problems);
    if (parsed) records.push(parsed);
  });

  if (records.length === 0) {
    return { accepted: 0, rejected: raw.length, problems };
  }

  const inserted = await insertTrafficLogs(records);

  const last = records[records.length - 1];
  await markIntersectionSeen(last.intersectionId, {
    status: last.health.sensorsOnline < last.health.sensorsTotal ? "degraded" : "online",
    controlMode: last.mode === "fixed" ? "fixed" : "adaptive",
    sensorsOnline: last.health.sensorsOnline,
    deviceId: last.deviceId,
  });

  return { accepted: inserted, rejected: raw.length - inserted, problems };
}

export function normaliseTelemetry(
  entry: unknown,
  index: number,
  problems: string[],
): TrafficLogRecord | null {
  if (typeof entry !== "object" || entry === null) {
    problems.push(`#${index}: not an object`);
    return null;
  }
  const e = entry as Record<string, unknown>;

  const intersectionId = typeof e.intersectionId === "string" ? e.intersectionId.trim() : "";
  if (!intersectionId) {
    problems.push(`#${index}: missing intersectionId`);
    return null;
  }

  const lanesRaw = Array.isArray(e.lanes) ? e.lanes : [];
  const lanes = lanesRaw.slice(0, 16).map((l) => {
    const lane = (l ?? {}) as Record<string, unknown>;
    return {
      laneId: String(lane.laneId ?? ""),
      approach: String(lane.approach ?? ""),
      movement: String(lane.movement ?? "through"),
      vehicleCount: num(lane.vehicleCount),
      queueLength: num(lane.queueLength),
      maxWait: num(lane.maxWait),
      signal: ["red", "yellow", "green"].includes(String(lane.signal))
        ? String(lane.signal)
        : "red",
    };
  });

  const metrics = (e.metrics ?? {}) as Record<string, unknown>;
  const health = (e.health ?? {}) as Record<string, unknown>;

  return {
    intersectionId,
    deviceId: typeof e.deviceId === "string" ? e.deviceId : "",
    recordedAt: isoOrNow(e.recordedAt),
    simTime: num(e.simTime),
    mode: e.mode === "fixed" ? "fixed" : "adaptive",
    currentPhase: String(e.currentPhase ?? ""),
    signalState: String(e.signalState ?? ""),
    lanes,
    metrics: {
      avgWaitTime: num(metrics.avgWaitTime),
      totalQueue: num(metrics.totalQueue),
      throughputPerHour: num(metrics.throughputPerHour),
      vehiclesServed: num(metrics.vehiclesServed),
      idleGreenPct: num(metrics.idleGreenPct),
    },
    health: {
      uptimeSeconds: num(health.uptimeSeconds),
      sensorsOnline: num(health.sensorsOnline, 8),
      sensorsTotal: num(health.sensorsTotal, 8),
    },
  };
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isoOrNow(value: unknown): string {
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}
