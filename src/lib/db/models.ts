import mongoose, { Schema, type Model } from "mongoose";

/**
 * Mongoose schemas for the STMS cloud tier.
 *
 * These correspond one-to-one with the database table definitions documented
 * in section 4.5 of the project report.
 *
 * Document shapes are written out explicitly rather than derived with
 * InferSchemaType: inferring them is extremely expensive for the TypeScript
 * compiler (it will exhaust the heap on a project this size), and an explicit
 * interface is easier to read alongside the schema anyway.
 *
 * Models are resolved lazily and reused from mongoose.models so that Next.js
 * hot reloading, which re-evaluates modules, does not raise "Cannot overwrite
 * model once compiled".
 */

export interface IntersectionDoc {
  intersectionId: string;
  name: string;
  location: { address: string; latitude: number; longitude: number };
  deviceId: string;
  approaches: string[];
  controlMode: "adaptive" | "fixed";
  status: "online" | "degraded" | "offline";
  lastSeenAt: Date | null;
  sensorsTotal: number;
  sensorsOnline: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LaneReading {
  laneId: string;
  approach: string;
  movement: string;
  vehicleCount: number;
  queueLength: number;
  maxWait: number;
  signal: string;
}

export interface TrafficLogDoc {
  intersectionId: string;
  deviceId: string;
  recordedAt: Date;
  simTime: number;
  mode: string;
  currentPhase: string;
  signalState: string;
  lanes: LaneReading[];
  metrics: {
    avgWaitTime: number;
    totalQueue: number;
    throughputPerHour: number;
    vehiclesServed: number;
    idleGreenPct: number;
  };
  health: { uptimeSeconds: number; sensorsOnline: number; sensorsTotal: number };
}

export interface OverrideCommandDoc {
  intersectionId: string;
  action: "force_phase" | "release" | "set_mode" | "emergency_preempt";
  phase: string;
  approach: string;
  mode: string;
  holdSeconds: number;
  issuedBy: string;
  status: "pending" | "acknowledged" | "expired";
  acknowledgedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IncidentDoc {
  intersectionId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  approach: string;
  message: string;
  responseSeconds: number;
  occurredAt: Date;
}

// ---------------------------------------------------------------------------
// intersections - one document per managed junction
// ---------------------------------------------------------------------------
const IntersectionSchema = new Schema<IntersectionDoc>(
  {
    intersectionId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    location: {
      address: { type: String, default: "" },
      latitude: { type: Number, default: 0 },
      longitude: { type: Number, default: 0 },
    },
    deviceId: { type: String, default: "" },
    approaches: { type: [String], default: ["N", "E", "S", "W"] },
    controlMode: { type: String, enum: ["adaptive", "fixed"], default: "adaptive" },
    status: { type: String, enum: ["online", "degraded", "offline"], default: "offline" },
    lastSeenAt: { type: Date, default: null },
    sensorsTotal: { type: Number, default: 8 },
    sensorsOnline: { type: Number, default: 8 },
  },
  { timestamps: true, collection: "intersections" },
);

// ---------------------------------------------------------------------------
// traffic_logs - the density time series (the core telemetry table)
// ---------------------------------------------------------------------------
const LaneReadingSchema = new Schema<LaneReading>(
  {
    laneId: { type: String, required: true },
    approach: { type: String, required: true },
    movement: { type: String, required: true },
    vehicleCount: { type: Number, required: true },
    queueLength: { type: Number, required: true },
    maxWait: { type: Number, default: 0 },
    signal: { type: String, enum: ["red", "yellow", "green"], required: true },
  },
  { _id: false },
);

const TrafficLogSchema = new Schema<TrafficLogDoc>(
  {
    intersectionId: { type: String, required: true, index: true },
    deviceId: { type: String, default: "" },
    recordedAt: { type: Date, required: true, index: true },
    simTime: { type: Number, default: 0 },
    mode: { type: String, enum: ["adaptive", "fixed"], default: "adaptive" },
    currentPhase: { type: String, default: "" },
    signalState: { type: String, default: "" },
    lanes: { type: [LaneReadingSchema], default: [] },
    metrics: {
      avgWaitTime: { type: Number, default: 0 },
      totalQueue: { type: Number, default: 0 },
      throughputPerHour: { type: Number, default: 0 },
      vehiclesServed: { type: Number, default: 0 },
      idleGreenPct: { type: Number, default: 0 },
    },
    health: {
      uptimeSeconds: { type: Number, default: 0 },
      sensorsOnline: { type: Number, default: 0 },
      sensorsTotal: { type: Number, default: 0 },
    },
  },
  { collection: "traffic_logs" },
);

// Compound index supporting the dashboard's "latest N for this junction" query.
TrafficLogSchema.index({ intersectionId: 1, recordedAt: -1 });

// ---------------------------------------------------------------------------
// override_commands - operator instructions travelling cloud -> edge
// ---------------------------------------------------------------------------
const OverrideCommandSchema = new Schema<OverrideCommandDoc>(
  {
    intersectionId: { type: String, required: true, index: true },
    action: {
      type: String,
      enum: ["force_phase", "release", "set_mode", "emergency_preempt"],
      required: true,
    },
    phase: { type: String, default: "" },
    approach: { type: String, default: "" },
    mode: { type: String, default: "" },
    holdSeconds: { type: Number, default: 20 },
    issuedBy: { type: String, default: "operator" },
    status: {
      type: String,
      enum: ["pending", "acknowledged", "expired"],
      default: "pending",
      index: true,
    },
    acknowledgedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "override_commands" },
);

// ---------------------------------------------------------------------------
// incidents - emergency preemptions and system faults, for the audit trail
// ---------------------------------------------------------------------------
const IncidentSchema = new Schema<IncidentDoc>(
  {
    intersectionId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: [
        "emergency_preemption",
        "sensor_fault",
        "max_out",
        "manual_override",
        "congestion_alert",
      ],
      required: true,
    },
    severity: { type: String, enum: ["info", "warning", "critical"], default: "info" },
    approach: { type: String, default: "" },
    message: { type: String, default: "" },
    responseSeconds: { type: Number, default: 0 },
    occurredAt: { type: Date, default: () => new Date(), index: true },
  },
  { collection: "incidents" },
);

function resolve<T>(name: string, schema: Schema<T>): Model<T> {
  const existing = mongoose.models[name] as Model<T> | undefined;
  return existing ?? mongoose.model<T>(name, schema);
}

export const Intersection = (): Model<IntersectionDoc> =>
  resolve<IntersectionDoc>("Intersection", IntersectionSchema);

export const TrafficLog = (): Model<TrafficLogDoc> =>
  resolve<TrafficLogDoc>("TrafficLog", TrafficLogSchema);

export const OverrideCommand = (): Model<OverrideCommandDoc> =>
  resolve<OverrideCommandDoc>("OverrideCommand", OverrideCommandSchema);

export const Incident = (): Model<IncidentDoc> =>
  resolve<IncidentDoc>("Incident", IncidentSchema);
