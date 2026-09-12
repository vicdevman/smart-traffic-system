/**
 * Signal control strategies.
 *
 * Two strategies are implemented behind one interface:
 *
 *   fixed     - the existing system described in section 3.3 of the report.
 *               A rigid cycle that serves every phase for the same number of
 *               seconds regardless of whether anybody is waiting.
 *
 *   adaptive  - the proposed system. A fully-actuated, demand-responsive
 *               controller that (a) allocates green time in proportion to
 *               measured density, (b) skips phases with no demand, (c) ends a
 *               green early when the queue has discharged (gap-out), and
 *               (d) preempts the cycle for emergency vehicles.
 *
 * Everything in this file is a pure function of the sensor readings, so the
 * exact same logic can be lifted onto a physical controller: replace the
 * simulated LaneDetection feed with readings from real IR/ultrasonic sensors
 * and the decisions are unchanged.
 */

import { PHASE_LANES, PHASES } from "./constants";
import type {
  ControlMode,
  LaneDetection,
  PhaseId,
  SimConfig,
} from "./types";

/** Aggregated demand for one phase, derived from its constituent lanes. */
export interface PhaseDemand {
  phase: PhaseId;
  /** Sum of queued vehicles across the lanes this phase serves. */
  queue: number;
  /** Longest wait endured by any vehicle this phase would serve, seconds. */
  maxWait: number;
  /** Seconds since this phase last ran. */
  timeSinceServed: number;
  /** True when an emergency vehicle is waiting on one of these lanes. */
  emergency: boolean;
  /** Composite ranking score - higher wins the right to run next. */
  score: number;
}

/**
 * Scores every phase so the controller can decide which to run next.
 *
 * The score blends three pressures:
 *   1. queue length          - the density signal D from the sensors
 *   2. worst wait in queue   - stops a small queue being starved forever
 *   3. time since last serve - a fairness term that grows without bound
 *
 * Emergency demand short-circuits scoring entirely and is handled by the
 * preemption path in the engine.
 */
export function rankPhases(
  detections: LaneDetection[],
  lastServedAt: Record<PhaseId, number>,
  now: number,
): PhaseDemand[] {
  const byLane = new Map(detections.map((d) => [d.laneId, d]));

  return PHASES.map((phase) => {
    const lanes = PHASE_LANES[phase]
      .map((laneId) => byLane.get(laneId))
      .filter((d): d is LaneDetection => Boolean(d));

    const queue = lanes.reduce((sum, d) => sum + d.queueLength, 0);
    const maxWait = lanes.reduce((max, d) => Math.max(max, d.maxWait), 0);
    const emergency = lanes.some((d) => d.emergencyPresent);
    const timeSinceServed = now - (lastServedAt[phase] ?? 0);

    // Weights chosen so that queue dominates in normal operation, while the
    // wait and starvation terms take over once a movement has been ignored
    // for roughly a full cycle.
    const score =
      queue * 1.0 + maxWait * 0.12 + timeSinceServed * 0.06 + (emergency ? 1000 : 0);

    return { phase, queue, maxWait, timeSinceServed, emergency, score };
  });
}

/**
 * Chooses the phase to run next.
 *
 * Fixed mode simply advances round-robin, which is precisely the behaviour
 * that produces idle green time on empty approaches.
 *
 * Adaptive mode picks the highest-scoring phase with actual demand, and skips
 * phases with an empty queue unless they have been starved past a full cycle,
 * in which case they are serviced briefly to keep the plan fair.
 */
export function selectNextPhase(
  mode: ControlMode,
  currentPhase: PhaseId,
  detections: LaneDetection[],
  lastServedAt: Record<PhaseId, number>,
  now: number,
  config: SimConfig,
): { phase: PhaseId; reason: string } {
  if (mode === "fixed") {
    const next = PHASES[(PHASES.indexOf(currentPhase) + 1) % PHASES.length];
    return { phase: next, reason: "fixed cycle advance" };
  }

  const ranked = rankPhases(detections, lastServedAt, now);
  const starvationLimit = config.maxGreen * 2;

  // Candidates are phases that have somebody waiting, plus any phase that has
  // gone unserved long enough to count as starved.
  const candidates = ranked.filter(
    (p) =>
      p.phase !== currentPhase &&
      (p.queue > 0 || p.timeSinceServed > starvationLimit),
  );

  if (candidates.length === 0) {
    // Nothing at all is waiting anywhere else. Hold the current phase rather
    // than cycling to empty approaches - this is the single biggest source of
    // the idle-green saving over the fixed-timer baseline.
    return { phase: currentPhase, reason: "no competing demand - holding" };
  }

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];

  const skipped = ranked.filter(
    (p) => p.phase !== winner.phase && p.phase !== currentPhase && p.queue === 0,
  );

  const reason =
    skipped.length > 0
      ? `demand ${winner.queue} veh, skipped ${skipped.length} empty phase(s)`
      : `highest demand ${winner.queue} veh`;

  return { phase: winner.phase, reason };
}

/**
 * Allocates green time for a phase that is about to start.
 *
 * This is the report's T is proportional to D rule, made physically concrete:
 * the time required to discharge a queue of D vehicles is the startup lost
 * time plus D saturation headways. The result is then clamped between the
 * pedestrian-clearance minimum and the starvation ceiling.
 *
 *     T = clamp(minGreen,  startupLost + D * headway,  maxGreen)
 */
export function computeGreenTime(
  mode: ControlMode,
  phase: PhaseId,
  detections: LaneDetection[],
  config: SimConfig,
): number {
  if (mode === "fixed") return config.fixedGreenTime;

  const byLane = new Map(detections.map((d) => [d.laneId, d]));
  const lanes = PHASE_LANES[phase]
    .map((laneId) => byLane.get(laneId))
    .filter((d): d is LaneDetection => Boolean(d));

  // Two lanes discharge in parallel, so the binding constraint is the longer
  // of the two queues, not their sum.
  const criticalQueue = lanes.reduce((max, d) => Math.max(max, d.queueLength), 0);

  const required =
    config.startupLostTime + criticalQueue * config.saturationHeadway;

  return Math.min(config.maxGreen, Math.max(config.minGreen, required));
}

/** The reason a green interval ended, surfaced in the event log. */
export type TerminationReason =
  | "max-out"
  | "gap-out"
  | "assigned-elapsed"
  | "preemption"
  | null;

/**
 * Decides whether the running green should end this tick.
 *
 * Fixed mode only ever ends on the clock. Adaptive mode additionally gaps out:
 * once the minimum green has been served and no vehicle has crossed the
 * stop-bar detector for `gapOutThreshold` seconds, the queue has clearly
 * discharged and holding the green any longer is pure waste.
 */
export function shouldTerminateGreen(
  mode: ControlMode,
  phase: PhaseId,
  elapsed: number,
  assignedGreen: number,
  detections: LaneDetection[],
  config: SimConfig,
): TerminationReason {
  if (mode === "fixed") {
    return elapsed >= assignedGreen ? "assigned-elapsed" : null;
  }

  if (elapsed >= config.maxGreen) return "max-out";
  if (elapsed < config.minGreen) return null;

  const byLane = new Map(detections.map((d) => [d.laneId, d]));
  const lanes = PHASE_LANES[phase]
    .map((laneId) => byLane.get(laneId))
    .filter((d): d is LaneDetection => Boolean(d));

  const stillDischarging = lanes.some(
    (d) =>
      d.stopBarOccupied || d.timeSinceLastDetection < config.gapOutThreshold,
  );

  if (!stillDischarging) return "gap-out";
  if (elapsed >= assignedGreen) {
    // The allocation has elapsed, but traffic is still flowing. Extend up to
    // maxGreen rather than cutting a moving platoon - this is what a real
    // actuated controller does.
    const anyQueue = lanes.some((d) => d.queueLength > 0);
    return anyQueue ? null : "assigned-elapsed";
  }

  return null;
}
