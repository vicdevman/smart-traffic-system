"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TrafficEngine } from "@/lib/sim/engine";
import { DEFAULT_CONFIG, PHASE_LABELS, SCENARIOS } from "@/lib/sim/constants";
import type {
  ApproachId,
  PhaseId,
  SimConfig,
  SimSnapshot,
  TelemetryPayload,
} from "@/lib/sim/types";

/**
 * Drives the two simulation engines and the cloud round-trip.
 *
 * The hook owns three loops:
 *
 *  1. An animation loop that advances both engines by the same amount of
 *     simulated time on every frame. The adaptive engine and the fixed-timer
 *     baseline are seeded identically, so they experience an identical arrival
 *     stream and the difference between their metrics is caused only by the
 *     control strategy.
 *
 *  2. A telemetry uploader that POSTs a batch of lane readings to the cloud on
 *     a wall-clock interval - exactly the payload a Raspberry Pi would send.
 *
 *  3. A command poller that collects operator overrides queued in the database
 *     and applies them to the adaptive engine, then acknowledges them. This is
 *     the full cloud-to-edge control path, not a shortcut through local state.
 */

const TELEMETRY_MS = Number(process.env.NEXT_PUBLIC_TELEMETRY_INTERVAL_MS ?? 5000);
const COMMAND_POLL_MS = Number(process.env.NEXT_PUBLIC_COMMAND_POLL_MS ?? 4000);

/** One point in the rolling chart series held in the browser. */
export interface HistoryPoint {
  t: number;
  adaptiveQueue: number;
  fixedQueue: number;
  adaptiveWait: number;
  fixedWait: number;
  adaptiveServed: number;
  fixedServed: number;
}

const MAX_HISTORY = 180;

export interface UseSimulationOptions {
  intersectionId: string;
  deviceId?: string;
}

export interface SimulationApi {
  adaptive: SimSnapshot | null;
  baseline: SimSnapshot | null;
  history: HistoryPoint[];
  running: boolean;
  speed: number;
  scenario: string;
  config: SimConfig;
  uploadState: { lastAt: number | null; count: number; error: string | null };
  commandState: { lastAppliedId: string | null; pending: number };
  start: () => void;
  pause: () => void;
  reset: () => void;
  setSpeed: (speed: number) => void;
  applyScenario: (key: string) => void;
  patchConfig: (patch: Partial<SimConfig>) => void;
  forcePhase: (phase: PhaseId, holdSeconds?: number) => void;
  releaseOverride: () => void;
  injectEmergency: (approach: ApproachId) => void;
}

export function useSimulation({
  intersectionId,
  deviceId = "RPI-EDGE-SIM",
}: UseSimulationOptions): SimulationApi {
  const adaptiveRef = useRef<TrafficEngine | null>(null);
  const baselineRef = useRef<TrafficEngine | null>(null);

  // Engines are created once, lazily, so that server rendering never touches
  // them and a re-render never discards accumulated simulation state.
  if (!adaptiveRef.current) {
    adaptiveRef.current = new TrafficEngine("adaptive", DEFAULT_CONFIG);
    baselineRef.current = new TrafficEngine("fixed", DEFAULT_CONFIG);
  }

  const [adaptive, setAdaptive] = useState<SimSnapshot | null>(null);
  const [baseline, setBaseline] = useState<SimSnapshot | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [running, setRunning] = useState(true);
  const [speed, setSpeedState] = useState(2);
  const [scenario, setScenario] = useState("balanced");
  const [config, setConfig] = useState<SimConfig>(DEFAULT_CONFIG);
  const [uploadState, setUploadState] = useState<SimulationApi["uploadState"]>({
    lastAt: null,
    count: 0,
    error: null,
  });
  const [commandState, setCommandState] = useState<SimulationApi["commandState"]>({
    lastAppliedId: null,
    pending: 0,
  });

  const runningRef = useRef(running);
  const speedRef = useRef(speed);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const lastSnapshotRef = useRef<number>(0);
  const lastHistoryRef = useRef<number>(0);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // -------------------------------------------------------------------------
  // 1. Animation / integration loop
  // -------------------------------------------------------------------------
  useEffect(() => {
    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);

      const last = lastFrameRef.current || now;
      lastFrameRef.current = now;
      const realDelta = (now - last) / 1000;

      if (runningRef.current) {
        // Cap the step so that returning to a backgrounded tab does not try to
        // simulate minutes of traffic in a single frame.
        const simSeconds = Math.min(realDelta * speedRef.current, 1.5);
        adaptiveRef.current?.advance(simSeconds);
        baselineRef.current?.advance(simSeconds);
      }

      // Publish snapshots at ~20fps rather than every frame: the physics runs
      // at full rate but React does not need to.
      if (now - lastSnapshotRef.current > 50) {
        lastSnapshotRef.current = now;
        const a = adaptiveRef.current?.getSnapshot() ?? null;
        const b = baselineRef.current?.getSnapshot() ?? null;
        setAdaptive(a);
        setBaseline(b);

        // Sample the comparison series once per second of wall clock.
        if (a && b && runningRef.current && now - lastHistoryRef.current > 1000) {
          lastHistoryRef.current = now;
          setHistory((prev) => {
            const next = [
              ...prev,
              {
                t: Math.round(a.time),
                adaptiveQueue: a.metrics.totalQueue,
                fixedQueue: b.metrics.totalQueue,
                adaptiveWait: Number(a.metrics.avgWaitTime.toFixed(2)),
                fixedWait: Number(b.metrics.avgWaitTime.toFixed(2)),
                adaptiveServed: a.metrics.vehiclesServed,
                fixedServed: b.metrics.vehiclesServed,
              },
            ];
            return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
          });
        }
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastFrameRef.current = 0;
    };
  }, []);

  // -------------------------------------------------------------------------
  // 2. Telemetry upload (edge -> cloud)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const upload = async () => {
      const engine = adaptiveRef.current;
      if (!engine || !runningRef.current) return;

      const snap = engine.getSnapshot();
      const idlePct =
        snap.metrics.totalGreenSeconds > 0
          ? (snap.metrics.idleGreenSeconds / snap.metrics.totalGreenSeconds) * 100
          : 0;

      const payload: TelemetryPayload = {
        intersectionId,
        deviceId,
        recordedAt: new Date().toISOString(),
        simTime: Number(snap.time.toFixed(1)),
        mode: snap.mode,
        currentPhase: snap.currentPhase,
        signalState: snap.state,
        lanes: snap.detections.map((d) => ({
          laneId: d.laneId,
          approach: d.approach,
          movement: d.movement,
          vehicleCount: d.occupancy,
          queueLength: d.queueLength,
          maxWait: Number(d.maxWait.toFixed(1)),
          signal: d.signal,
        })),
        metrics: {
          avgWaitTime: Number(snap.metrics.avgWaitTime.toFixed(2)),
          totalQueue: snap.metrics.totalQueue,
          throughputPerHour: Math.round(snap.metrics.throughputPerHour),
          vehiclesServed: snap.metrics.vehiclesServed,
          idleGreenPct: Number(idlePct.toFixed(1)),
        },
        health: {
          uptimeSeconds: Math.round(snap.time),
          sensorsOnline: 8,
          sensorsTotal: 8,
        },
      };

      try {
        const res = await fetch("/api/edge/telemetry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setUploadState((s) => ({ lastAt: Date.now(), count: s.count + 1, error: null }));
      } catch (error) {
        setUploadState((s) => ({
          ...s,
          error: error instanceof Error ? error.message : "upload failed",
        }));
      }
    };

    const id = setInterval(upload, Math.max(1000, TELEMETRY_MS));
    return () => clearInterval(id);
  }, [intersectionId, deviceId]);

  // -------------------------------------------------------------------------
  // 3. Command polling (cloud -> edge)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/edge/commands?intersectionId=${encodeURIComponent(intersectionId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          commands: Array<{
            id: string;
            action: string;
            phase?: string;
            approach?: string;
            holdSeconds: number;
          }>;
        };
        if (!Array.isArray(data.commands) || data.commands.length === 0) {
          setCommandState((s) => ({ ...s, pending: 0 }));
          return;
        }

        const engine = adaptiveRef.current;
        const applied: string[] = [];

        for (const cmd of data.commands) {
          if (!engine) break;
          if (cmd.action === "force_phase" && cmd.phase) {
            engine.forcePhase(cmd.phase as PhaseId, cmd.holdSeconds);
          } else if (cmd.action === "release") {
            engine.clearOverride();
          } else if (cmd.action === "emergency_preempt" && cmd.approach) {
            engine.injectEmergency(cmd.approach as ApproachId);
          }
          applied.push(cmd.id);
        }

        if (applied.length > 0) {
          setCommandState({ lastAppliedId: applied[applied.length - 1], pending: 0 });
          await fetch("/api/edge/commands", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids: applied }),
          });
        }
      } catch {
        // A poll failure is non-fatal: the edge keeps running on its own
        // control logic and simply retries on the next tick. This is the
        // behaviour required of a real controller on a flaky link.
      }
    };

    const id = setInterval(poll, Math.max(1500, COMMAND_POLL_MS));
    return () => clearInterval(id);
  }, [intersectionId]);

  // -------------------------------------------------------------------------
  // Control surface
  // -------------------------------------------------------------------------

  const start = useCallback(() => setRunning(true), []);
  const pause = useCallback(() => setRunning(false), []);

  const reset = useCallback(() => {
    const patch = SCENARIOS[scenario]?.patch ?? {};
    const nextConfig = { ...DEFAULT_CONFIG, ...patch, seed: Date.now() % 100000 };
    adaptiveRef.current?.reset(nextConfig);
    baselineRef.current?.reset(nextConfig);
    setConfig(nextConfig);
    setHistory([]);
  }, [scenario]);

  const setSpeed = useCallback((next: number) => setSpeedState(next), []);

  const applyScenario = useCallback((key: string) => {
    const preset = SCENARIOS[key];
    if (!preset) return;
    setScenario(key);
    // A fresh seed per scenario keeps runs independent, while both engines
    // still share it so the comparison stays controlled.
    const nextConfig = { ...DEFAULT_CONFIG, ...preset.patch, seed: Date.now() % 100000 };
    adaptiveRef.current?.reset(nextConfig);
    baselineRef.current?.reset(nextConfig);
    setConfig(nextConfig);
    setHistory([]);
  }, []);

  const patchConfig = useCallback((patch: Partial<SimConfig>) => {
    adaptiveRef.current?.patchConfig(patch);
    baselineRef.current?.patchConfig(patch);
    setConfig((c) => ({ ...c, ...patch }));
  }, []);

  const forcePhase = useCallback((phase: PhaseId, holdSeconds = 20) => {
    adaptiveRef.current?.forcePhase(phase, holdSeconds);
  }, []);

  const releaseOverride = useCallback(() => {
    adaptiveRef.current?.clearOverride();
  }, []);

  const injectEmergency = useCallback((approach: ApproachId) => {
    adaptiveRef.current?.injectEmergency(approach);
    baselineRef.current?.injectEmergency(approach);
  }, []);

  return {
    adaptive,
    baseline,
    history,
    running,
    speed,
    scenario,
    config,
    uploadState,
    commandState,
    start,
    pause,
    reset,
    setSpeed,
    applyScenario,
    patchConfig,
    forcePhase,
    releaseOverride,
    injectEmergency,
  };
}

export { PHASE_LABELS };
