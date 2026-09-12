import type {
  ApproachId,
  LaneId,
  MovementId,
  PhaseId,
  SimConfig,
  VehicleClass,
} from "./types";

export const APPROACHES: ApproachId[] = ["N", "E", "S", "W"];
export const MOVEMENTS: MovementId[] = ["through", "left"];

export const LANES: LaneId[] = APPROACHES.flatMap((a) =>
  MOVEMENTS.map((m) => `${a}-${m}` as LaneId),
);

export const PHASES: PhaseId[] = [
  "NS_THROUGH",
  "NS_LEFT",
  "EW_THROUGH",
  "EW_LEFT",
];

/** Which lanes receive a green indication during each phase. */
export const PHASE_LANES: Record<PhaseId, LaneId[]> = {
  NS_THROUGH: ["N-through", "S-through"],
  NS_LEFT: ["N-left", "S-left"],
  EW_THROUGH: ["E-through", "W-through"],
  EW_LEFT: ["E-left", "W-left"],
};

/** Display names used across the dashboard and event log. */
export const PHASE_LABELS: Record<PhaseId, string> = {
  NS_THROUGH: "North-South Through",
  NS_LEFT: "North-South Left",
  EW_THROUGH: "East-West Through",
  EW_LEFT: "East-West Left",
};

export const APPROACH_LABELS: Record<ApproachId, string> = {
  N: "Northbound",
  E: "Eastbound",
  S: "Southbound",
  W: "Westbound",
};

/**
 * The phase that must be running to let an emergency vehicle on a given
 * approach through. Emergency vehicles are routed straight through, so the
 * through phase for their corridor is the one to call.
 */
export const EMERGENCY_PHASE_FOR_APPROACH: Record<ApproachId, PhaseId> = {
  N: "NS_THROUGH",
  S: "NS_THROUGH",
  E: "EW_THROUGH",
  W: "EW_THROUGH",
};

/** Physical and behavioural properties per vehicle class. */
export const VEHICLE_SPECS: Record<
  VehicleClass,
  { length: number; speedFactor: number; label: string }
> = {
  car: { length: 4.5, speedFactor: 1.0, label: "Car" },
  bus: { length: 11, speedFactor: 0.85, label: "Bus" },
  truck: { length: 9, speedFactor: 0.8, label: "Truck" },
  ambulance: { length: 6, speedFactor: 1.15, label: "Emergency" },
};

/** Minimum bumper-to-bumper gap held by a stopped vehicle, metres. */
export const MIN_GAP = 2.0;
/** Comfortable acceleration, m/s^2. */
export const ACCELERATION = 2.2;
/** Comfortable deceleration used for gap-keeping, m/s^2. */
export const DECELERATION = 3.5;
/** Speed below which a vehicle is considered stopped, m/s. */
export const STOPPED_SPEED = 0.6;
/** Where vehicles enter the model, metres upstream of the stop line. */
export const SPAWN_DISTANCE = 240;
/** Width of the intersection box a vehicle must traverse, metres. */
export const INTERSECTION_WIDTH = 22;
/** Litres of fuel burned per hour by one idling vehicle. */
export const IDLE_FUEL_LPH = 0.7;
/** Kilograms of CO2 released per litre of petrol burned. */
export const CO2_KG_PER_LITRE = 2.31;

/** Fixed integration step, seconds. Small enough for stable car-following. */
export const TIME_STEP = 0.1;

export const DEFAULT_CONFIG: SimConfig = {
  seed: 20260911,
  baseDemandVph: 620,
  approachWeights: { N: 1.25, E: 0.85, S: 1.1, W: 0.8 },
  leftTurnRatio: 0.28,
  emergencyRate: 0.006,
  minGreen: 8,
  maxGreen: 45,
  yellowTime: 3,
  allRedTime: 2,
  fixedGreenTime: 25,
  gapOutThreshold: 3,
  detectionZone: 120,
  freeFlowSpeed: 13.9,
  saturationHeadway: 2.0,
  startupLostTime: 2.0,
};

/** Preset demand scenarios offered in the dashboard control panel. */
export const SCENARIOS: Record<
  string,
  { label: string; description: string; patch: Partial<SimConfig> }
> = {
  balanced: {
    label: "Balanced Flow",
    description: "Even demand on all four approaches, moderate volume.",
    patch: {
      baseDemandVph: 520,
      approachWeights: { N: 1, E: 1, S: 1, W: 1 },
    },
  },
  rushHour: {
    label: "Morning Rush",
    description: "Heavy north-south commuter surge into the city centre.",
    patch: {
      baseDemandVph: 780,
      approachWeights: { N: 1.5, E: 0.6, S: 1.35, W: 0.55 },
    },
  },
  lopsided: {
    label: "Lopsided Demand",
    description:
      "One dominant corridor - the case where fixed timers waste the most green.",
    patch: {
      baseDemandVph: 620,
      approachWeights: { N: 1.9, E: 0.25, S: 1.6, W: 0.3 },
    },
  },
  offPeak: {
    label: "Off Peak",
    description: "Light night-time traffic with long idle periods.",
    patch: {
      baseDemandVph: 200,
      approachWeights: { N: 1, E: 0.8, S: 0.9, W: 0.7 },
    },
  },
  emergencyDrill: {
    label: "Emergency Drill",
    description: "Elevated ambulance frequency to exercise signal preemption.",
    patch: {
      baseDemandVph: 600,
      approachWeights: { N: 1.2, E: 1, S: 1.1, W: 0.9 },
      emergencyRate: 0.035,
    },
  },
};

export function laneOf(approach: ApproachId, movement: MovementId): LaneId {
  return `${approach}-${movement}` as LaneId;
}

export function splitLane(laneId: LaneId): {
  approach: ApproachId;
  movement: MovementId;
} {
  const [approach, movement] = laneId.split("-") as [ApproachId, MovementId];
  return { approach, movement };
}
