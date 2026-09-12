/**
 * Core type definitions for the STMS traffic simulation kernel.
 *
 * The vocabulary here deliberately mirrors real traffic-engineering practice
 * (approach, movement, phase, saturation headway, gap-out, preemption) so that
 * the same interfaces can be implemented by a physical Raspberry Pi controller
 * without changing anything upstream of the sensor layer.
 */

/** The four compass approaches feeding a standard four-way intersection. */
export type ApproachId = "N" | "E" | "S" | "W";

/** Movements served from an approach. Right turns share the through lane. */
export type MovementId = "through" | "left";

/** A physical lane = one approach + one movement, e.g. "N-through". */
export type LaneId = `${ApproachId}-${MovementId}`;

/**
 * Signal phases. This is a standard 4-phase plan in which opposing approaches
 * are served together, which is how real four-way intersections maximise
 * throughput without conflicting movements.
 */
export type PhaseId = "NS_THROUGH" | "NS_LEFT" | "EW_THROUGH" | "EW_LEFT";

/** Aspect currently displayed by a signal head. */
export type SignalColor = "red" | "yellow" | "green";

/** Internal state of the signal controller state machine. */
export type ControllerState = "GREEN" | "YELLOW" | "ALL_RED";

/** Which control strategy an engine instance is running. */
export type ControlMode = "adaptive" | "fixed";

/** Vehicle categories, used for size, behaviour and priority. */
export type VehicleClass = "car" | "bus" | "truck" | "ambulance";

export interface Vehicle {
  id: string;
  lane: LaneId;
  vclass: VehicleClass;
  /** Vehicle body length in metres (affects queue storage). */
  length: number;
  /** Distance in metres from the stop line. Positive = still approaching. */
  dist: number;
  /** Current speed, metres/second. */
  speed: number;
  /** Simulation time (s) at which the vehicle entered the network. */
  arrivalTime: number;
  /** Accumulated seconds spent at (near) standstill. */
  waitTime: number;
  /** Number of times the vehicle came to a complete stop. */
  stops: number;
  /** True while counted as stopped; used to detect the edge into a new stop. */
  isStopped: boolean;
  /** Emergency vehicles trigger signal preemption. */
  isEmergency: boolean;
  /** 0..1 once the vehicle crosses the stop line; drives crossing animation. */
  crossingProgress?: number;
}

/** What the sensors at an intersection report for a single lane. */
export interface LaneDetection {
  laneId: LaneId;
  approach: ApproachId;
  movement: MovementId;
  /** Vehicles standing in the detection zone - the density signal D. */
  queueLength: number;
  /** Vehicles present in the zone regardless of speed. */
  occupancy: number;
  /** True when a vehicle sits over the stop-bar detector (drives gap-out). */
  stopBarOccupied: boolean;
  /** Seconds since a vehicle last crossed the stop-bar detector. */
  timeSinceLastDetection: number;
  /** Longest wait currently being endured in this lane, seconds. */
  maxWait: number;
  /** True when an emergency vehicle is inside the detection zone. */
  emergencyPresent: boolean;
  /** Signal currently displayed to this lane. */
  signal: SignalColor;
}

/** Rolling performance measures produced by an engine instance. */
export interface SimMetrics {
  /** Vehicles that have fully cleared the intersection. */
  vehiclesServed: number;
  /** Vehicles currently in the network. */
  vehiclesInNetwork: number;
  /** Mean seconds of standstill per served vehicle. */
  avgWaitTime: number;
  /** Mean control delay (travel time minus free-flow time) per served vehicle. */
  avgDelay: number;
  /** Worst individual wait observed so far, seconds. */
  maxWaitTime: number;
  /** Mean stops per served vehicle. */
  avgStops: number;
  /** Vehicles cleared per hour, extrapolated from elapsed simulated time. */
  throughputPerHour: number;
  /** Total queued vehicles across every lane right now. */
  totalQueue: number;
  /** Longest single-lane queue right now. */
  maxQueue: number;
  /**
   * Green seconds displayed to a lane that had nothing waiting - the
   * "idle green time" the proposed system is designed to eliminate.
   */
  idleGreenSeconds: number;
  /** Total green seconds served, used to express idle green as a percentage. */
  totalGreenSeconds: number;
  /** Mean seconds from emergency detection to that vehicle clearing. */
  avgEmergencyResponse: number;
  /** Emergency vehicles fully served. */
  emergenciesServed: number;
  /** Estimated litres of fuel burned while idling. */
  fuelWastedLitres: number;
  /** Estimated CO2 in kilograms from idling. */
  co2Kg: number;
}

/** Tunable parameters shared by both control strategies. */
export interface SimConfig {
  /** Deterministic seed - identical seeds produce identical arrival streams. */
  seed: number;
  /** Base arrival rate per approach, vehicles/hour, before weighting. */
  baseDemandVph: number;
  /** Per-approach demand multipliers, letting one corridor dominate. */
  approachWeights: Record<ApproachId, number>;
  /** Share of arrivals that turn left rather than going through/right. */
  leftTurnRatio: number;
  /** Probability that any given arrival is an emergency vehicle. */
  emergencyRate: number;
  /** Minimum green, seconds - pedestrian clearance floor. */
  minGreen: number;
  /** Maximum green, seconds - starvation ceiling. */
  maxGreen: number;
  /** Yellow change interval, seconds. */
  yellowTime: number;
  /** All-red clearance interval, seconds. */
  allRedTime: number;
  /** Fixed-timer split per phase, seconds (baseline system only). */
  fixedGreenTime: number;
  /** Seconds of headway allowed before an actuated green gaps out. */
  gapOutThreshold: number;
  /** Length of the upstream detection zone, metres. */
  detectionZone: number;
  /** Free-flow speed, metres/second (13.9 m/s = 50 km/h). */
  freeFlowSpeed: number;
  /** Saturation headway between departing vehicles, seconds. */
  saturationHeadway: number;
  /** Seconds lost to driver reaction at the start of every green. */
  startupLostTime: number;
}

/** Full immutable snapshot of an engine, consumed by React for rendering. */
export interface SimSnapshot {
  mode: ControlMode;
  /** Elapsed simulated time, seconds. */
  time: number;
  state: ControllerState;
  currentPhase: PhaseId;
  /** Seconds spent in the current controller state. */
  timeInState: number;
  /** Green length the controller allocated to the running phase. */
  assignedGreen: number;
  /** Countdown shown on the dashboard, seconds. */
  remaining: number;
  /** Signal aspect per approach, for the intersection view. */
  signals: Record<ApproachId, { through: SignalColor; left: SignalColor }>;
  detections: LaneDetection[];
  vehicles: Vehicle[];
  metrics: SimMetrics;
  /** True while an emergency preemption is being served. */
  preemptionActive: boolean;
  preemptionApproach: ApproachId | null;
  /** Phase currently forced by an operator, or null under automatic control. */
  overridePhase: PhaseId | null;
  /** Human-readable decisions emitted by the controller. */
  events: SimEvent[];
}

export interface SimEvent {
  id: string;
  time: number;
  level: "info" | "success" | "warning" | "critical";
  message: string;
}

/** A telemetry batch - exactly what a Raspberry Pi would POST to the cloud. */
export interface TelemetryPayload {
  intersectionId: string;
  deviceId: string;
  recordedAt: string;
  simTime: number;
  mode: ControlMode;
  currentPhase: PhaseId;
  signalState: ControllerState;
  lanes: Array<{
    laneId: LaneId;
    approach: ApproachId;
    movement: MovementId;
    vehicleCount: number;
    queueLength: number;
    maxWait: number;
    signal: SignalColor;
  }>;
  metrics: {
    avgWaitTime: number;
    totalQueue: number;
    throughputPerHour: number;
    vehiclesServed: number;
    idleGreenPct: number;
  };
  health: {
    uptimeSeconds: number;
    sensorsOnline: number;
    sensorsTotal: number;
  };
}
