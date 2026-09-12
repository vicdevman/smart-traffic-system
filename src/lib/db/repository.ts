/**
 * Data-access layer.
 *
 * Every route handler talks to this module rather than to Mongoose directly.
 * It transparently selects one of two backends:
 *
 *   MongoDB      when MONGODB_URI is configured and reachable
 *   In-memory    otherwise - so the system remains fully demonstrable with
 *                zero infrastructure, which matters for a live defence where
 *                network access cannot be guaranteed.
 *
 * The in-memory store is deliberately bounded so a long-running demo cannot
 * exhaust the serverless function's memory.
 */

import { connectToDatabase, isDatabaseConfigured } from "./mongoose";
import { Incident, Intersection, OverrideCommand, TrafficLog } from "./models";

export type StorageBackend = "mongodb" | "memory";

export interface IntersectionRecord {
  intersectionId: string;
  name: string;
  location: { address: string; latitude: number; longitude: number };
  deviceId: string;
  approaches: string[];
  controlMode: "adaptive" | "fixed";
  status: "online" | "degraded" | "offline";
  lastSeenAt: string | null;
  sensorsTotal: number;
  sensorsOnline: number;
}

export interface TrafficLogRecord {
  intersectionId: string;
  deviceId: string;
  recordedAt: string;
  simTime: number;
  mode: string;
  currentPhase: string;
  signalState: string;
  lanes: Array<{
    laneId: string;
    approach: string;
    movement: string;
    vehicleCount: number;
    queueLength: number;
    maxWait: number;
    signal: string;
  }>;
  metrics: {
    avgWaitTime: number;
    totalQueue: number;
    throughputPerHour: number;
    vehiclesServed: number;
    idleGreenPct: number;
  };
  health: { uptimeSeconds: number; sensorsOnline: number; sensorsTotal: number };
}

export interface OverrideRecord {
  id: string;
  intersectionId: string;
  action: "force_phase" | "release" | "set_mode" | "emergency_preempt";
  phase?: string;
  approach?: string;
  mode?: string;
  holdSeconds: number;
  issuedBy: string;
  status: "pending" | "acknowledged" | "expired";
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface IncidentRecord {
  id: string;
  intersectionId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  approach: string;
  message: string;
  responseSeconds: number;
  occurredAt: string;
}

// ---------------------------------------------------------------------------
// In-memory fallback store
// ---------------------------------------------------------------------------

const MAX_LOGS = 2000;
const MAX_INCIDENTS = 500;

interface MemoryStore {
  intersections: Map<string, IntersectionRecord>;
  logs: TrafficLogRecord[];
  overrides: OverrideRecord[];
  incidents: IncidentRecord[];
  seq: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __stmsMemory: MemoryStore | undefined;
}

const DEFAULT_INTERSECTIONS: IntersectionRecord[] = [
  {
    intersectionId: "INT-001",
    name: "Ahmadu Bello Way / Herbert Macaulay Junction",
    location: { address: "Central Business District", latitude: 6.4531, longitude: 3.3958 },
    deviceId: "RPI-EDGE-001",
    approaches: ["N", "E", "S", "W"],
    controlMode: "adaptive",
    status: "offline",
    lastSeenAt: null,
    sensorsTotal: 8,
    sensorsOnline: 8,
  },
  {
    intersectionId: "INT-002",
    name: "University Road / Market Square",
    location: { address: "North Campus Gate", latitude: 6.5162, longitude: 3.3897 },
    deviceId: "RPI-EDGE-002",
    approaches: ["N", "E", "S", "W"],
    controlMode: "adaptive",
    status: "offline",
    lastSeenAt: null,
    sensorsTotal: 8,
    sensorsOnline: 7,
  },
  {
    intersectionId: "INT-003",
    name: "Airport Road / Ring Road Interchange",
    location: { address: "Southern Bypass", latitude: 6.4281, longitude: 3.4219 },
    deviceId: "RPI-EDGE-003",
    approaches: ["N", "E", "S", "W"],
    controlMode: "fixed",
    status: "offline",
    lastSeenAt: null,
    sensorsTotal: 8,
    sensorsOnline: 8,
  },
];

function memory(): MemoryStore {
  if (!global.__stmsMemory) {
    global.__stmsMemory = {
      intersections: new Map(DEFAULT_INTERSECTIONS.map((i) => [i.intersectionId, { ...i }])),
      logs: [],
      overrides: [],
      incidents: [],
      seq: 0,
    };
  }
  return global.__stmsMemory;
}

/** Resolves which backend is actually in use for this request. */
export async function getBackend(): Promise<StorageBackend> {
  if (!isDatabaseConfigured()) return "memory";
  const conn = await connectToDatabase();
  return conn ? "mongodb" : "memory";
}

// ---------------------------------------------------------------------------
// Intersections
// ---------------------------------------------------------------------------

export async function listIntersections(): Promise<IntersectionRecord[]> {
  if ((await getBackend()) === "mongodb") {
    const docs = await Intersection().find().lean();
    if (docs.length === 0) {
      // First run against an empty cluster - seed the reference junctions.
      await Intersection().insertMany(DEFAULT_INTERSECTIONS.map(toMongoIntersection));
      return DEFAULT_INTERSECTIONS;
    }
    return docs.map(fromMongoIntersection);
  }
  return [...memory().intersections.values()];
}

export async function getIntersection(id: string): Promise<IntersectionRecord | null> {
  if ((await getBackend()) === "mongodb") {
    const doc = await Intersection().findOne({ intersectionId: id }).lean();
    return doc ? fromMongoIntersection(doc) : null;
  }
  return memory().intersections.get(id) ?? null;
}

export async function markIntersectionSeen(
  id: string,
  patch: Partial<Pick<IntersectionRecord, "status" | "controlMode" | "sensorsOnline" | "deviceId">>,
): Promise<void> {
  const now = new Date().toISOString();
  if ((await getBackend()) === "mongodb") {
    await Intersection().updateOne(
      { intersectionId: id },
      { $set: { ...patch, lastSeenAt: new Date(now) } },
      { upsert: true },
    );
    return;
  }
  const store = memory();
  const existing = store.intersections.get(id);
  if (existing) {
    store.intersections.set(id, { ...existing, ...patch, lastSeenAt: now });
  } else {
    store.intersections.set(id, {
      intersectionId: id,
      name: id,
      location: { address: "", latitude: 0, longitude: 0 },
      deviceId: patch.deviceId ?? "",
      approaches: ["N", "E", "S", "W"],
      controlMode: patch.controlMode ?? "adaptive",
      status: patch.status ?? "online",
      lastSeenAt: now,
      sensorsTotal: 8,
      sensorsOnline: patch.sensorsOnline ?? 8,
    });
  }
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export async function insertTrafficLogs(logs: TrafficLogRecord[]): Promise<number> {
  if (logs.length === 0) return 0;

  if ((await getBackend()) === "mongodb") {
    await TrafficLog().insertMany(
      logs.map((l) => ({ ...l, recordedAt: new Date(l.recordedAt) })),
      { ordered: false },
    );
    return logs.length;
  }

  const store = memory();
  store.logs.push(...logs);
  if (store.logs.length > MAX_LOGS) {
    store.logs.splice(0, store.logs.length - MAX_LOGS);
  }
  return logs.length;
}

export async function getTrafficLogs(
  intersectionId: string,
  limit = 120,
): Promise<TrafficLogRecord[]> {
  if ((await getBackend()) === "mongodb") {
    const docs = await TrafficLog()
      .find({ intersectionId })
      .sort({ recordedAt: -1 })
      .limit(limit)
      .lean();
    return docs.map(fromMongoLog).reverse();
  }
  return memory()
    .logs.filter((l) => l.intersectionId === intersectionId)
    .slice(-limit);
}

// ---------------------------------------------------------------------------
// Override commands (cloud -> edge)
// ---------------------------------------------------------------------------

export async function createOverride(
  input: Omit<OverrideRecord, "id" | "status" | "createdAt" | "acknowledgedAt">,
): Promise<OverrideRecord> {
  const now = new Date().toISOString();

  if ((await getBackend()) === "mongodb") {
    const doc = await OverrideCommand().create({ ...input, status: "pending" });
    return {
      id: String(doc._id),
      intersectionId: doc.intersectionId,
      action: doc.action as OverrideRecord["action"],
      phase: doc.phase ?? undefined,
      approach: doc.approach ?? undefined,
      mode: doc.mode ?? undefined,
      holdSeconds: doc.holdSeconds ?? 20,
      issuedBy: doc.issuedBy ?? "operator",
      status: "pending",
      createdAt: now,
      acknowledgedAt: null,
    };
  }

  const store = memory();
  const record: OverrideRecord = {
    ...input,
    id: `ovr-${++store.seq}`,
    status: "pending",
    createdAt: now,
    acknowledgedAt: null,
  };
  store.overrides.push(record);
  if (store.overrides.length > 200) store.overrides.shift();
  return record;
}

export async function listPendingOverrides(intersectionId: string): Promise<OverrideRecord[]> {
  if ((await getBackend()) === "mongodb") {
    const docs = await OverrideCommand()
      .find({ intersectionId, status: "pending" })
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();
    return docs.map((d) => ({
      id: String(d._id),
      intersectionId: d.intersectionId,
      action: d.action as OverrideRecord["action"],
      phase: d.phase ?? undefined,
      approach: d.approach ?? undefined,
      mode: d.mode ?? undefined,
      holdSeconds: d.holdSeconds ?? 20,
      issuedBy: d.issuedBy ?? "operator",
      status: "pending" as const,
      createdAt: new Date((d as { createdAt?: Date }).createdAt ?? Date.now()).toISOString(),
      acknowledgedAt: null,
    }));
  }
  return memory().overrides.filter(
    (o) => o.intersectionId === intersectionId && o.status === "pending",
  );
}

export async function acknowledgeOverrides(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const now = new Date();

  if ((await getBackend()) === "mongodb") {
    const res = await OverrideCommand().updateMany(
      { _id: { $in: ids } },
      { $set: { status: "acknowledged", acknowledgedAt: now } },
    );
    return res.modifiedCount;
  }

  let count = 0;
  for (const o of memory().overrides) {
    if (ids.includes(o.id) && o.status === "pending") {
      o.status = "acknowledged";
      o.acknowledgedAt = now.toISOString();
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export async function createIncident(
  input: Omit<IncidentRecord, "id" | "occurredAt"> & { occurredAt?: string },
): Promise<IncidentRecord> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();

  if ((await getBackend()) === "mongodb") {
    const doc = await Incident().create({ ...input, occurredAt: new Date(occurredAt) });
    return { ...input, id: String(doc._id), occurredAt };
  }

  const store = memory();
  const record: IncidentRecord = { ...input, id: `inc-${++store.seq}`, occurredAt };
  store.incidents.push(record);
  if (store.incidents.length > MAX_INCIDENTS) store.incidents.shift();
  return record;
}

export async function listIncidents(
  intersectionId?: string,
  limit = 50,
): Promise<IncidentRecord[]> {
  if ((await getBackend()) === "mongodb") {
    const filter = intersectionId ? { intersectionId } : {};
    const docs = await Incident().find(filter).sort({ occurredAt: -1 }).limit(limit).lean();
    return docs.map((d) => ({
      id: String(d._id),
      intersectionId: d.intersectionId,
      type: d.type,
      severity: d.severity as IncidentRecord["severity"],
      approach: d.approach ?? "",
      message: d.message ?? "",
      responseSeconds: d.responseSeconds ?? 0,
      occurredAt: new Date(d.occurredAt ?? Date.now()).toISOString(),
    }));
  }
  const all = memory().incidents;
  const filtered = intersectionId
    ? all.filter((i) => i.intersectionId === intersectionId)
    : all;
  return filtered.slice(-limit).reverse();
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

type LeanIntersection = {
  intersectionId: string;
  name: string;
  location?: { address?: string; latitude?: number; longitude?: number };
  deviceId?: string;
  approaches?: string[];
  controlMode?: string;
  status?: string;
  lastSeenAt?: Date | null;
  sensorsTotal?: number;
  sensorsOnline?: number;
};

function fromMongoIntersection(doc: LeanIntersection): IntersectionRecord {
  return {
    intersectionId: doc.intersectionId,
    name: doc.name,
    location: {
      address: doc.location?.address ?? "",
      latitude: doc.location?.latitude ?? 0,
      longitude: doc.location?.longitude ?? 0,
    },
    deviceId: doc.deviceId ?? "",
    approaches: doc.approaches ?? ["N", "E", "S", "W"],
    controlMode: (doc.controlMode as "adaptive" | "fixed") ?? "adaptive",
    status: (doc.status as IntersectionRecord["status"]) ?? "offline",
    lastSeenAt: doc.lastSeenAt ? new Date(doc.lastSeenAt).toISOString() : null,
    sensorsTotal: doc.sensorsTotal ?? 8,
    sensorsOnline: doc.sensorsOnline ?? 8,
  };
}

function toMongoIntersection(rec: IntersectionRecord) {
  return { ...rec, lastSeenAt: rec.lastSeenAt ? new Date(rec.lastSeenAt) : null };
}

type LeanLog = Omit<TrafficLogRecord, "recordedAt"> & { recordedAt: Date };

function fromMongoLog(doc: LeanLog): TrafficLogRecord {
  return { ...doc, recordedAt: new Date(doc.recordedAt).toISOString() };
}
