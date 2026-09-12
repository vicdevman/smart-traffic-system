"use client";

import { useEffect, useState } from "react";
import { ComparisonPanel } from "@/components/ComparisonPanel";
import { ControlPanel } from "@/components/ControlPanel";
import { EventLog } from "@/components/EventLog";
import { IntersectionCanvas } from "@/components/IntersectionCanvas";
import { LaneTable } from "@/components/LaneTable";
import { Badge, Card, Meter, SignalDot, StatTile } from "@/components/ui";
import { useSimulation } from "@/hooks/useSimulation";
import { PHASE_LABELS } from "@/lib/sim/constants";

const DEFAULT_INTERSECTION =
  process.env.NEXT_PUBLIC_DEFAULT_INTERSECTION ?? "INT-001";

/** Set NEXT_PUBLIC_SHOW_DEMO_BANNER=false to hide the banner during a live presentation. */
const SHOW_DEMO_BANNER = process.env.NEXT_PUBLIC_SHOW_DEMO_BANNER !== "false";

interface HealthInfo {
  storage: { backend: string; persistent: boolean; note: string };
  security: { deviceKeyEnforced: boolean; operatorPasscodeEnforced: boolean };
}

export default function DashboardPage() {
  const [intersectionId] = useState(DEFAULT_INTERSECTION);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [canvasSize, setCanvasSize] = useState(520);

  const sim = useSimulation({ intersectionId });

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  // Keep the plan view square and inside its column on small screens.
  useEffect(() => {
    const resize = () => {
      const w = window.innerWidth;
      setCanvasSize(w < 480 ? Math.max(280, w - 72) : w < 1024 ? 420 : 520);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const snap = sim.adaptive;
  const metrics = snap?.metrics;

  const idlePct =
    metrics && metrics.totalGreenSeconds > 0
      ? (metrics.idleGreenSeconds / metrics.totalGreenSeconds) * 100
      : 0;

  return (
    <div className="space-y-4">
      {/* ---- Status strip -------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold tracking-tight">Control Room</h1>
        <Badge tone="accent" pulse={sim.running}>
          {intersectionId}
        </Badge>
        {sim.running ? (
          <Badge tone="good" pulse>
            Live
          </Badge>
        ) : (
          <Badge tone="warn">Paused</Badge>
        )}
        {snap?.preemptionActive && (
          <Badge tone="bad" pulse>
            Emergency preemption
          </Badge>
        )}
        {health && (
          <Badge tone={health.storage.persistent ? "good" : "warn"}>
            {health.storage.persistent ? "MongoDB" : "In-memory"}
          </Badge>
        )}
        <span className="ml-auto text-[11px] text-[var(--color-ink-faint)]">
          {sim.uploadState.error
            ? `Telemetry error: ${sim.uploadState.error}`
            : sim.uploadState.lastAt
              ? `${sim.uploadState.count} telemetry batches uploaded`
              : "Awaiting first telemetry upload"}
        </span>
      </div>

      {SHOW_DEMO_BANNER && health && !health.storage.persistent && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-200/90">
          <strong className="font-semibold">Demo mode.</strong> No{" "}
          <code className="rounded bg-black/30 px-1">MONGODB_URI</code> is configured, so telemetry
          is being written to an in-memory store and will be lost when the server restarts.
          Everything else - the control algorithm, the API contract, the operator command loop -
          behaves identically. See the setup guide to connect MongoDB Atlas.
        </p>
      )}

      {/* ---- Main grid ------------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card
            title="Live intersection"
            subtitle="Plan view of the simulated junction. Vehicle positions are the true model state."
            action={
              snap && (
                <div className="flex items-center gap-2">
                  <SignalDot
                    color={
                      snap.state === "GREEN"
                        ? "green"
                        : snap.state === "YELLOW"
                          ? "yellow"
                          : "red"
                    }
                  />
                  <span className="tnum text-[11px] text-[var(--color-ink-dim)]">
                    {snap.remaining.toFixed(0)}s
                  </span>
                </div>
              )
            }
            bodyClassName="flex flex-col items-center gap-3"
          >
            <IntersectionCanvas snapshot={snap} size={canvasSize} />

            {snap && (
              <div className="w-full space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-[var(--color-ink-dim)]">
                    Running phase:{" "}
                    <strong className="font-medium text-[var(--color-ink)]">
                      {PHASE_LABELS[snap.currentPhase]}
                    </strong>
                  </span>
                  <span className="tnum text-[var(--color-ink-faint)]">
                    {snap.state} · allocated {snap.assignedGreen.toFixed(0)}s · elapsed{" "}
                    {snap.timeInState.toFixed(0)}s
                  </span>
                </div>
                <Meter
                  value={Math.round(snap.timeInState)}
                  max={Math.max(1, Math.round(snap.assignedGreen))}
                  tone={
                    snap.state === "GREEN" ? "good" : snap.state === "YELLOW" ? "warn" : "bad"
                  }
                />
              </div>
            )}
          </Card>

          {/* ---- KPI row --------------------------------------------------- */}
          {metrics && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile
                label="Avg wait"
                value={metrics.avgWaitTime.toFixed(1)}
                unit="s"
                tone="accent"
              />
              <StatTile label="Queued" value={metrics.totalQueue} tone={metrics.totalQueue > 20 ? "bad" : "neutral"} />
              <StatTile label="Served" value={metrics.vehiclesServed} />
              <StatTile
                label="Throughput"
                value={Math.round(metrics.throughputPerHour)}
                unit="veh/h"
              />
              <StatTile
                label="Idle green"
                value={idlePct.toFixed(1)}
                unit="%"
                tone={idlePct > 15 ? "warn" : "good"}
              />
              <StatTile
                label="Sim clock"
                value={formatClock(snap?.time ?? 0)}
                hint={`${sim.speed}x speed`}
              />
            </div>
          )}

          <Card
            title="Sensor readout"
            subtitle="One row per lane - the density feed the controller acts on."
          >
            {snap ? (
              <LaneTable detections={snap.detections} />
            ) : (
              <p className="text-xs text-[var(--color-ink-faint)]">Initialising sensors...</p>
            )}
          </Card>

          <Card
            title="Controller decision log"
            subtitle="Every phase change, with the reason the algorithm chose it."
          >
            <EventLog events={snap?.events ?? []} />
          </Card>
        </div>

        {/* ---- Right rail ------------------------------------------------- */}
        <div className="space-y-4">
          <ControlPanel
            intersectionId={intersectionId}
            running={sim.running}
            speed={sim.speed}
            scenario={sim.scenario}
            config={sim.config}
            overrideActive={Boolean(snap?.overridePhase)}
            onStart={sim.start}
            onPause={sim.pause}
            onReset={sim.reset}
            onSpeed={sim.setSpeed}
            onScenario={sim.applyScenario}
            onPatchConfig={sim.patchConfig}
            onLocalEmergency={sim.injectEmergency}
          />

          <Card title="Edge device" subtitle="Health of the controller reporting to this dashboard.">
            <dl className="space-y-1.5 text-[11px]">
              <Row label="Device ID" value="RPI-EDGE-SIM" />
              <Row label="Link" value={sim.uploadState.error ? "degraded" : "online"} />
              <Row label="Batches sent" value={String(sim.uploadState.count)} />
              <Row
                label="Last upload"
                value={
                  sim.uploadState.lastAt
                    ? `${Math.round((Date.now() - sim.uploadState.lastAt) / 1000)}s ago`
                    : "-"
                }
              />
              <Row label="Sensors" value="8 / 8 online" />
              <Row
                label="Device auth"
                value={health?.security.deviceKeyEnforced ? "enforced" : "open (demo)"}
              />
              <Row
                label="Operator auth"
                value={health?.security.operatorPasscodeEnforced ? "enforced" : "open (demo)"}
              />
            </dl>
          </Card>
        </div>
      </div>

      {/* ---- Comparison ---------------------------------------------------- */}
      <ComparisonPanel adaptive={sim.adaptive} baseline={sim.baseline} history={sim.history} />
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

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
