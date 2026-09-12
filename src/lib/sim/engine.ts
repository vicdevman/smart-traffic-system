/**
 * The STMS simulation kernel.
 *
 * This class plays the role that a Raspberry Pi + IR sensor array would play
 * in the hardware build. It maintains a microscopic (vehicle-by-vehicle)
 * model of one four-way intersection:
 *
 *   - vehicles arrive as a Poisson process per lane,
 *   - they follow a car-following law that reproduces realistic queue
 *     formation, stop-and-go waves and saturation discharge,
 *   - a virtual sensor layer converts vehicle positions into the same lane
 *     detections a real IR/ultrasonic array would emit,
 *   - and the signal controller from ./controller.ts acts on those detections.
 *
 * Two instances are run in lockstep by the dashboard - one adaptive, one
 * fixed-timer - seeded identically so that the two receive an identical
 * arrival stream and any performance difference is caused solely by control.
 */

import {
  ACCELERATION,
  APPROACHES,
  CO2_KG_PER_LITRE,
  DECELERATION,
  DEFAULT_CONFIG,
  EMERGENCY_PHASE_FOR_APPROACH,
  IDLE_FUEL_LPH,
  INTERSECTION_WIDTH,
  LANES,
  MIN_GAP,
  PHASE_LABELS,
  PHASE_LANES,
  SPAWN_DISTANCE,
  STOPPED_SPEED,
  TIME_STEP,
  VEHICLE_SPECS,
  splitLane,
} from "./constants";
import { computeGreenTime, selectNextPhase, shouldTerminateGreen } from "./controller";
import { SeededRandom } from "./random";
import type {
  ApproachId,
  ControlMode,
  ControllerState,
  LaneDetection,
  LaneId,
  PhaseId,
  SignalColor,
  SimConfig,
  SimEvent,
  SimMetrics,
  SimSnapshot,
  Vehicle,
  VehicleClass,
} from "./types";

const MAX_EVENTS = 80;

/** Distance band over the stop-bar detector, metres. */
const STOP_BAR_ZONE = 10;

/**
 * Longest a single preemption may hold a green, seconds.
 *
 * Without this ceiling a steady stream of emergency vehicles on one corridor
 * would hold its green indefinitely and starve the cross street completely.
 * Real preemption units impose exactly this kind of limit.
 */
const MAX_PREEMPTION_HOLD = 30;

/**
 * Enforced gap between the end of one preemption and the start of the next,
 * seconds. During the cooldown an emergency vehicle still gets priority - the
 * controller's ranking gives its phase an overwhelming score - but it can no
 * longer freeze the cycle.
 */
const PREEMPTION_COOLDOWN = 18;

interface LaneRuntime {
  vehicles: Vehicle[];
  nextArrival: number;
  timeSinceLastDetection: number;
}

export class TrafficEngine {
  readonly mode: ControlMode;
  private config: SimConfig;
  private rng: SeededRandom;

  private lanes: Record<LaneId, LaneRuntime>;
  private time = 0;
  private vehicleSeq = 0;
  private eventSeq = 0;

  private state: ControllerState = "GREEN";
  private currentPhase: PhaseId = "NS_THROUGH";
  private timeInState = 0;
  private assignedGreen: number;
  private lastServedAt: Record<PhaseId, number>;

  private preemptionActive = false;
  private preemptionApproach: ApproachId | null = null;
  private preemptionStartedAt = 0;
  private preemptionCooldownUntil = 0;
  private pendingPhase: PhaseId | null = null;

  /** Operator-forced phase, set from the dashboard control panel. */
  private overridePhase: PhaseId | null = null;
  private overrideUntil = 0;

  private events: SimEvent[] = [];
  private detections: LaneDetection[] = [];

  // --- metric accumulators -------------------------------------------------
  private served = 0;
  private sumWait = 0;
  private sumDelay = 0;
  private sumStops = 0;
  private maxWaitSeen = 0;
  private idleGreen = 0;
  private totalGreen = 0;
  private emergenciesServed = 0;
  private sumEmergencyResponse = 0;
  private fuelLitres = 0;

  constructor(mode: ControlMode, config: Partial<SimConfig> = {}) {
    this.mode = mode;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = new SeededRandom(this.config.seed);
    this.lanes = this.blankLanes();
    this.assignedGreen = this.config.fixedGreenTime;
    this.lastServedAt = {
      NS_THROUGH: 0,
      NS_LEFT: 0,
      EW_THROUGH: 0,
      EW_LEFT: 0,
    };
    this.refreshDetections();
    this.log("info", `${mode === "adaptive" ? "Adaptive" : "Fixed-timer"} controller initialised`);
  }

  private blankLanes(): Record<LaneId, LaneRuntime> {
    const out = {} as Record<LaneId, LaneRuntime>;
    for (const laneId of LANES) {
      out[laneId] = { vehicles: [], nextArrival: 0, timeSinceLastDetection: 99 };
    }
    return out;
  }

  // =========================================================================
  // Public control surface
  // =========================================================================

  /** Replaces configuration and restarts from a clean state. */
  reset(config: Partial<SimConfig> = {}): void {
    this.config = { ...this.config, ...config };
    this.rng = new SeededRandom(this.config.seed);
    this.lanes = this.blankLanes();
    this.time = 0;
    this.vehicleSeq = 0;
    this.state = "GREEN";
    this.currentPhase = "NS_THROUGH";
    this.timeInState = 0;
    this.assignedGreen = this.config.fixedGreenTime;
    this.lastServedAt = { NS_THROUGH: 0, NS_LEFT: 0, EW_THROUGH: 0, EW_LEFT: 0 };
    this.preemptionActive = false;
    this.preemptionApproach = null;
    this.pendingPhase = null;
    this.overridePhase = null;
    this.overrideUntil = 0;
    this.events = [];
    this.served = 0;
    this.sumWait = 0;
    this.sumDelay = 0;
    this.sumStops = 0;
    this.maxWaitSeen = 0;
    this.idleGreen = 0;
    this.totalGreen = 0;
    this.emergenciesServed = 0;
    this.sumEmergencyResponse = 0;
    this.fuelLitres = 0;
    this.refreshDetections();
    this.log("info", "Simulation reset");
  }

  getConfig(): SimConfig {
    return { ...this.config };
  }

  /** Applies a live configuration patch without losing simulation state. */
  patchConfig(patch: Partial<SimConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  /**
   * Operator override - forces a phase for a fixed hold time.
   * Only meaningful for the adaptive controller; the fixed baseline models a
   * legacy unit with no remote control interface at all.
   */
  forcePhase(phase: PhaseId, holdSeconds = 20): void {
    if (this.mode !== "adaptive") return;
    this.overridePhase = phase;
    this.overrideUntil = this.time + holdSeconds;
    this.log(
      "warning",
      `Operator override: forcing ${PHASE_LABELS[phase]} for ${holdSeconds}s`,
    );
    if (this.currentPhase !== phase && this.state === "GREEN") {
      this.pendingPhase = phase;
      this.enterState("YELLOW");
    }
  }

  clearOverride(): void {
    if (this.overridePhase) {
      this.overridePhase = null;
      this.overrideUntil = 0;
      this.log("info", "Operator override released - returning to adaptive control");
    }
  }

  /** Injects an emergency vehicle on demand, for live demonstrations. */
  injectEmergency(approach: ApproachId): void {
    const laneId = `${approach}-through` as LaneId;
    this.spawn(laneId, true, "ambulance");
    this.log("critical", `Emergency vehicle detected on ${approach} approach`);
  }

  /**
   * Advances the model by `seconds` of simulated time in fixed sub-steps.
   *
   * The request is capped at five seconds so that returning to a tab that has
   * been backgrounded for minutes does not attempt to catch up in one blocking
   * loop. Simulated time simply skips the gap, which is the right trade for a
   * monitoring view.
   */
  advance(seconds: number): void {
    let remaining = Math.min(Math.max(seconds, 0), 5);
    while (remaining > 1e-6) {
      const dt = Math.min(TIME_STEP, remaining);
      this.step(dt);
      remaining -= dt;
    }
  }

  // =========================================================================
  // Simulation step
  // =========================================================================

  private step(dt: number): void {
    this.time += dt;
    this.generateArrivals();
    this.refreshDetections(dt);
    this.updateController(dt);
    this.moveVehicles(dt);
    this.accrueMetrics(dt);
  }

  // --- arrivals ------------------------------------------------------------

  /**
   * Poisson arrivals per lane. Headways are drawn from an exponential
   * distribution whose mean is 3600/rate seconds.
   *
   * The RNG is consumed in a strict, identical order in every engine instance
   * (headway, then class, then emergency roll) so the adaptive and fixed
   * engines see byte-identical traffic.
   */
  private generateArrivals(): void {
    for (const laneId of LANES) {
      const lane = this.lanes[laneId];
      const { approach, movement } = splitLane(laneId);
      const approachRate = this.config.baseDemandVph * this.config.approachWeights[approach];
      const laneRate =
        movement === "left"
          ? approachRate * this.config.leftTurnRatio
          : approachRate * (1 - this.config.leftTurnRatio);

      if (laneRate <= 0) continue;
      const meanHeadway = 3600 / laneRate;

      while (this.time >= lane.nextArrival) {
        const vclass = this.rng.weighted<VehicleClass>({
          car: 0.82,
          bus: 0.05,
          truck: 0.13,
          ambulance: 0,
        });
        const isEmergency = this.rng.chance(this.config.emergencyRate);
        this.spawn(laneId, isEmergency, isEmergency ? "ambulance" : vclass);
        lane.nextArrival += this.rng.exponential(meanHeadway);
      }
    }
  }

  private spawn(laneId: LaneId, isEmergency: boolean, vclass: VehicleClass): void {
    const lane = this.lanes[laneId];
    const spec = VEHICLE_SPECS[vclass];

    // If the queue has spilled back past the model boundary, place the new
    // arrival behind the last vehicle instead of discarding it, so vehicle
    // conservation (and therefore the comparison) stays exact.
    const tail = lane.vehicles[lane.vehicles.length - 1];
    const minDist = tail ? tail.dist + tail.length + MIN_GAP : 0;
    const dist = Math.max(SPAWN_DISTANCE, minDist);

    lane.vehicles.push({
      id: `v${++this.vehicleSeq}`,
      lane: laneId,
      vclass,
      length: spec.length,
      dist,
      speed: this.config.freeFlowSpeed * spec.speedFactor,
      arrivalTime: this.time,
      waitTime: 0,
      stops: 0,
      isStopped: false,
      isEmergency,
    });
  }

  // --- virtual sensor layer -----------------------------------------------

  /**
   * Converts vehicle positions into lane detections.
   *
   * This is the seam where hardware plugs in: a real deployment replaces this
   * method with a read from the GPIO pins / camera pipeline and everything
   * downstream is untouched.
   */
  private refreshDetections(dt = 0): void {
    const detections: LaneDetection[] = [];

    for (const laneId of LANES) {
      const lane = this.lanes[laneId];
      const { approach, movement } = splitLane(laneId);
      const signal = this.signalFor(laneId);

      let queueLength = 0;
      let occupancy = 0;
      let maxWait = 0;
      let stopBarOccupied = false;
      let emergencyPresent = false;

      for (const v of lane.vehicles) {
        if (v.dist > 0 && v.dist <= this.config.detectionZone) {
          occupancy++;
          if (v.speed < STOPPED_SPEED * 4) queueLength++;
          if (v.waitTime > maxWait) maxWait = v.waitTime;
          if (v.isEmergency) emergencyPresent = true;
        }
        if (v.dist <= STOP_BAR_ZONE && v.dist > -INTERSECTION_WIDTH) {
          stopBarOccupied = true;
        }
      }

      if (stopBarOccupied) lane.timeSinceLastDetection = 0;
      else lane.timeSinceLastDetection += dt;

      detections.push({
        laneId,
        approach,
        movement,
        queueLength,
        occupancy,
        stopBarOccupied,
        timeSinceLastDetection: lane.timeSinceLastDetection,
        maxWait,
        emergencyPresent,
        signal,
      });
    }

    this.detections = detections;
  }

  // --- signal controller ---------------------------------------------------

  private signalFor(laneId: LaneId): SignalColor {
    const served = PHASE_LANES[this.currentPhase].includes(laneId);
    if (!served) return "red";
    if (this.state === "GREEN") return "green";
    if (this.state === "YELLOW") return "yellow";
    return "red";
  }

  private enterState(next: ControllerState): void {
    this.state = next;
    this.timeInState = 0;
  }

  private updateController(dt: number): void {
    this.timeInState += dt;

    if (this.overridePhase && this.time > this.overrideUntil) {
      this.clearOverride();
    }

    switch (this.state) {
      case "GREEN":
        this.updateGreen();
        break;
      case "YELLOW":
        if (this.timeInState >= this.config.yellowTime) this.enterState("ALL_RED");
        break;
      case "ALL_RED":
        if (this.timeInState >= this.config.allRedTime) this.beginNextGreen();
        break;
    }
  }

  private updateGreen(): void {
    // 1. Emergency preemption takes priority over every other consideration,
    //    subject to a hold ceiling and a cooldown so that it can never starve
    //    the cross street.
    if (this.mode === "adaptive") {
      const emergency = this.detectEmergency();

      if (this.preemptionActive) {
        const held = this.time - this.preemptionStartedAt;

        if (!emergency) {
          this.endPreemption("Emergency cleared - resuming adaptive control", "success");
        } else if (held >= MAX_PREEMPTION_HOLD) {
          this.endPreemption(
            `Preemption hold limit (${MAX_PREEMPTION_HOLD}s) reached - releasing to protect cross-street service`,
            "warning",
          );
        } else {
          // Still serving the emergency: hold this green.
          return;
        }
      } else if (emergency && this.time >= this.preemptionCooldownUntil) {
        const target = EMERGENCY_PHASE_FOR_APPROACH[emergency];
        this.preemptionActive = true;
        this.preemptionApproach = emergency;
        this.preemptionStartedAt = this.time;

        if (this.currentPhase === target) {
          this.log("critical", `Preemption: holding green for ${emergency} emergency corridor`);
          return;
        }

        this.pendingPhase = target;
        this.log(
          "critical",
          `Preemption: cutting ${PHASE_LABELS[this.currentPhase]} for ${emergency} emergency`,
        );
        this.enterState("YELLOW");
        return;
      }
      // Outside a preemption and inside the cooldown, an emergency still wins
      // the next phase selection: rankPhases scores its movement far above
      // every other. It simply cannot freeze the current green any more.
    }

    // 2. Operator override holds its phase for the duration of the hold time.
    if (this.overridePhase && this.currentPhase === this.overridePhase) return;

    // 3. Normal termination logic.
    const reason = shouldTerminateGreen(
      this.mode,
      this.currentPhase,
      this.timeInState,
      this.assignedGreen,
      this.detections,
      this.config,
    );

    if (!reason) return;

    if (reason === "gap-out") {
      const saved = Math.max(0, this.assignedGreen - this.timeInState);
      this.log(
        "success",
        `Gap-out on ${PHASE_LABELS[this.currentPhase]} after ${this.timeInState.toFixed(0)}s` +
          (saved > 1 ? ` - ${saved.toFixed(0)}s of green recovered` : ""),
      );
    } else if (reason === "max-out") {
      this.log("warning", `${PHASE_LABELS[this.currentPhase]} reached maximum green`);
    }

    // In adaptive mode, if nothing else is waiting there is no point cycling.
    if (this.mode === "adaptive" && !this.overridePhase) {
      const { phase } = selectNextPhase(
        this.mode,
        this.currentPhase,
        this.detections,
        this.lastServedAt,
        this.time,
        this.config,
      );
      if (phase === this.currentPhase) {
        // Hold the current green; re-arm the allocation so the countdown on
        // the dashboard stays meaningful.
        this.assignedGreen = Math.max(this.assignedGreen, this.timeInState + 5);
        return;
      }
      this.pendingPhase = phase;
    }

    this.enterState("YELLOW");
  }

  /** Clears preemption state and arms the cooldown. */
  private endPreemption(message: string, level: SimEvent["level"]): void {
    this.preemptionActive = false;
    this.preemptionApproach = null;
    this.preemptionCooldownUntil = this.time + PREEMPTION_COOLDOWN;
    this.log(level, message);
  }

  private detectEmergency(): ApproachId | null {
    for (const approach of APPROACHES) {
      const hit = this.detections.find(
        (d) => d.approach === approach && d.emergencyPresent,
      );
      if (hit) return approach;
    }
    return null;
  }

  private beginNextGreen(): void {
    this.lastServedAt[this.currentPhase] = this.time;

    let next: PhaseId;
    let reason: string;

    if (this.pendingPhase) {
      next = this.pendingPhase;
      reason = this.preemptionActive ? "emergency preemption" : "operator/controller request";
      this.pendingPhase = null;
    } else {
      const choice = selectNextPhase(
        this.mode,
        this.currentPhase,
        this.detections,
        this.lastServedAt,
        this.time,
        this.config,
      );
      next = choice.phase;
      reason = choice.reason;
    }

    this.currentPhase = next;
    this.assignedGreen = computeGreenTime(this.mode, next, this.detections, this.config);
    this.enterState("GREEN");
    this.refreshDetections();

    this.log(
      "info",
      `${PHASE_LABELS[next]} green for ${this.assignedGreen.toFixed(0)}s (${reason})`,
    );
  }

  // --- vehicle dynamics ----------------------------------------------------

  /**
   * Car-following update.
   *
   * Each vehicle computes the distance it is permitted to advance - bounded by
   * the rear bumper of its leader and, if the signal forbids entry, by the
   * stop line - then picks the fastest speed from which it could still stop
   * within that distance. This single rule reproduces queue build-up, the
   * startup wave at the beginning of green, and saturation-flow discharge.
   */
  private moveVehicles(dt: number): void {
    for (const laneId of LANES) {
      const lane = this.lanes[laneId];
      const signal = this.signalFor(laneId);
      const list = lane.vehicles;

      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        const spec = VEHICLE_SPECS[v.vclass];
        const vmax = this.config.freeFlowSpeed * spec.speedFactor;

        // Constraint 1: the vehicle ahead.
        let allowed = Number.POSITIVE_INFINITY;
        const leader = list[i - 1];
        if (leader) {
          allowed = v.dist - leader.dist - leader.length - MIN_GAP;
        }

        // Constraint 2: the signal, only while still upstream of the stop line.
        if (v.dist > 0) {
          const mustStop =
            signal === "red" ||
            (signal === "yellow" &&
              v.dist > (v.speed * v.speed) / (2 * DECELERATION));
          // Emergency vehicles still obey red, but the controller will already
          // have preempted the signal in their favour by this point.
          if (mustStop) allowed = Math.min(allowed, v.dist - 0.2);
        }

        allowed = Math.max(0, allowed);

        // Fastest speed from which the vehicle could still stop in `allowed`.
        const safeSpeed = Math.sqrt(2 * DECELERATION * allowed);
        const target = Math.min(vmax, safeSpeed);

        if (target > v.speed) {
          v.speed = Math.min(target, v.speed + ACCELERATION * dt);
        } else {
          v.speed = Math.max(target, v.speed - DECELERATION * 1.6 * dt);
        }
        v.speed = Math.max(0, v.speed);

        const advance = Math.min(v.speed * dt, allowed);
        const wasUpstream = v.dist > 0;
        v.dist -= advance;

        // Stop / wait bookkeeping.
        if (v.speed < STOPPED_SPEED && v.dist > 0) {
          v.waitTime += dt;
          if (!v.isStopped) {
            v.isStopped = true;
            v.stops++;
          }
        } else if (v.speed > STOPPED_SPEED * 2) {
          v.isStopped = false;
        }

        // The moment the front bumper crosses the stop line, the vehicle is
        // counted as served.
        if (wasUpstream && v.dist <= 0) {
          this.recordDeparture(v);
        }
        if (v.dist <= 0) {
          v.crossingProgress = Math.min(
            1,
            -v.dist / (INTERSECTION_WIDTH + v.length),
          );
        }
      }

      // Retire vehicles that have fully cleared the intersection box.
      lane.vehicles = list.filter((v) => v.dist > -(INTERSECTION_WIDTH + v.length));
    }
  }

  private recordDeparture(v: Vehicle): void {
    this.served++;
    this.sumWait += v.waitTime;
    this.sumStops += v.stops;
    if (v.waitTime > this.maxWaitSeen) this.maxWaitSeen = v.waitTime;

    const spec = VEHICLE_SPECS[v.vclass];
    const freeFlowTime = SPAWN_DISTANCE / (this.config.freeFlowSpeed * spec.speedFactor);
    const actualTime = this.time - v.arrivalTime;
    this.sumDelay += Math.max(0, actualTime - freeFlowTime);

    if (v.isEmergency) {
      this.emergenciesServed++;
      this.sumEmergencyResponse += actualTime;
    }
  }

  // --- metrics -------------------------------------------------------------

  private accrueMetrics(dt: number): void {
    if (this.state === "GREEN") {
      this.totalGreen += dt;
      const servedLanes = PHASE_LANES[this.currentPhase];

      const servedDemand = this.detections.some(
        (d) => servedLanes.includes(d.laneId) && d.occupancy > 0,
      );
      const elsewhereWaiting = this.detections.some(
        (d) => !servedLanes.includes(d.laneId) && d.queueLength > 0,
      );

      // Idle green is green displayed to an empty approach *while another
      // approach has vehicles waiting*. That conditional matters: a controller
      // resting in green on an empty junction at 3am is not wasting anything,
      // because there is nobody else to serve. Counting that as waste would
      // flatter the fixed-timer baseline and misrepresent both systems.
      if (!servedDemand && elsewhereWaiting) this.idleGreen += dt;
    }

    let idling = 0;
    for (const laneId of LANES) {
      for (const v of this.lanes[laneId].vehicles) {
        if (v.speed < STOPPED_SPEED && v.dist > 0) idling++;
      }
    }
    this.fuelLitres += (idling * IDLE_FUEL_LPH * dt) / 3600;
  }

  private buildMetrics(): SimMetrics {
    const totalQueue = this.detections.reduce((s, d) => s + d.queueLength, 0);
    const maxQueue = this.detections.reduce((m, d) => Math.max(m, d.queueLength), 0);
    const inNetwork = LANES.reduce((s, l) => s + this.lanes[l].vehicles.length, 0);
    const hours = this.time / 3600;

    return {
      vehiclesServed: this.served,
      vehiclesInNetwork: inNetwork,
      avgWaitTime: this.served ? this.sumWait / this.served : 0,
      avgDelay: this.served ? this.sumDelay / this.served : 0,
      maxWaitTime: this.maxWaitSeen,
      avgStops: this.served ? this.sumStops / this.served : 0,
      throughputPerHour: hours > 0 ? this.served / hours : 0,
      totalQueue,
      maxQueue,
      idleGreenSeconds: this.idleGreen,
      totalGreenSeconds: this.totalGreen,
      avgEmergencyResponse: this.emergenciesServed
        ? this.sumEmergencyResponse / this.emergenciesServed
        : 0,
      emergenciesServed: this.emergenciesServed,
      fuelWastedLitres: this.fuelLitres,
      co2Kg: this.fuelLitres * CO2_KG_PER_LITRE,
    };
  }

  // --- output --------------------------------------------------------------

  private log(level: SimEvent["level"], message: string): void {
    this.events.unshift({
      id: `e${++this.eventSeq}`,
      time: this.time,
      level,
      message,
    });
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
  }

  getSnapshot(): SimSnapshot {
    const signals = {} as SimSnapshot["signals"];
    for (const approach of APPROACHES) {
      signals[approach] = {
        through: this.signalFor(`${approach}-through` as LaneId),
        left: this.signalFor(`${approach}-left` as LaneId),
      };
    }

    const vehicles: Vehicle[] = [];
    for (const laneId of LANES) {
      for (const v of this.lanes[laneId].vehicles) vehicles.push({ ...v });
    }

    let remaining = 0;
    if (this.state === "GREEN") remaining = Math.max(0, this.assignedGreen - this.timeInState);
    else if (this.state === "YELLOW") remaining = Math.max(0, this.config.yellowTime - this.timeInState);
    else remaining = Math.max(0, this.config.allRedTime - this.timeInState);

    return {
      mode: this.mode,
      time: this.time,
      state: this.state,
      currentPhase: this.currentPhase,
      timeInState: this.timeInState,
      assignedGreen: this.assignedGreen,
      remaining,
      signals,
      detections: this.detections.map((d) => ({ ...d })),
      vehicles,
      metrics: this.buildMetrics(),
      preemptionActive: this.preemptionActive,
      preemptionApproach: this.preemptionApproach,
      overridePhase: this.overridePhase,
      events: this.events.slice(0, 40),
    };
  }

  /** True while an operator override is in force. */
  isOverridden(): boolean {
    return this.overridePhase !== null;
  }

  getOverridePhase(): PhaseId | null {
    return this.overridePhase;
  }
}
