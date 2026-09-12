"use client";

import { useState } from "react";
import { APPROACH_LABELS, PHASES, PHASE_LABELS, SCENARIOS } from "@/lib/sim/constants";
import type { ApproachId, PhaseId, SimConfig } from "@/lib/sim/types";
import { Badge, Button, Card } from "./ui";

/**
 * Operator console.
 *
 * Manual actions (forcing a phase, triggering a preemption) are not applied
 * locally. They are POSTed to /api/overrides, queued in the database, and only
 * take effect when the edge controller polls for them and applies them - the
 * same round trip a warden's command would make in the field. The latency you
 * see on screen is therefore real command latency, not a cosmetic delay.
 */

export function ControlPanel({
  intersectionId,
  running,
  speed,
  scenario,
  config,
  overrideActive,
  onStart,
  onPause,
  onReset,
  onSpeed,
  onScenario,
  onPatchConfig,
  onLocalEmergency,
}: {
  intersectionId: string;
  running: boolean;
  speed: number;
  scenario: string;
  config: SimConfig;
  overrideActive: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onSpeed: (s: number) => void;
  onScenario: (key: string) => void;
  onPatchConfig: (patch: Partial<SimConfig>) => void;
  onLocalEmergency: (approach: ApproachId) => void;
}) {
  const [passcode, setPasscode] = useState("");
  const [status, setStatus] = useState<{ tone: "good" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCommand(body: Record<string, unknown>, description: string) {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/overrides", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(passcode ? { "x-operator-passcode": passcode } : {}),
        },
        body: JSON.stringify({ intersectionId, issuedBy: "dashboard-operator", ...body }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };

      if (res.status === 401) {
        setStatus({ tone: "bad", text: "Operator passcode rejected. Check OPERATOR_PASSCODE." });
      } else if (!res.ok || !data.ok) {
        setStatus({ tone: "bad", text: data.error ?? `Request failed (${res.status})` });
      } else {
        setStatus({ tone: "good", text: `${description} queued - awaiting controller acknowledgement.` });
      }
    } catch {
      setStatus({ tone: "bad", text: "Network error - the command was not queued." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Simulation control"
        subtitle="Drives the virtual edge controller standing in for the roadside hardware."
      >
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button onClick={onPause}>Pause</Button>
          ) : (
            <Button variant="primary" onClick={onStart}>
              Run
            </Button>
          )}
          <Button onClick={onReset}>Reset run</Button>
          <div className="ml-auto flex items-center gap-1.5">
            {[1, 2, 5, 10].map((s) => (
              <button
                key={s}
                onClick={() => onSpeed(s)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium tnum transition-colors ${
                  speed === s
                    ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                    : "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
            Demand scenario
          </p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {Object.entries(SCENARIOS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => onScenario(key)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  scenario === key
                    ? "border-sky-500/50 bg-sky-500/10"
                    : "border-[var(--color-line)] bg-[var(--color-surface-2)] hover:border-[#2c3a52]"
                }`}
              >
                <span className="block text-[12px] font-medium text-[var(--color-ink)]">
                  {preset.label}
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-[var(--color-ink-faint)]">
                  {preset.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <Slider
            label="Traffic volume"
            value={config.baseDemandVph}
            min={100}
            max={1100}
            step={20}
            unit="veh/h per approach"
            onChange={(v) => onPatchConfig({ baseDemandVph: v })}
          />
          <Slider
            label="Minimum green"
            value={config.minGreen}
            min={5}
            max={20}
            step={1}
            unit="s"
            onChange={(v) => onPatchConfig({ minGreen: v })}
          />
          <Slider
            label="Maximum green"
            value={config.maxGreen}
            min={20}
            max={90}
            step={5}
            unit="s"
            onChange={(v) => onPatchConfig({ maxGreen: v })}
          />
          <Slider
            label="Gap-out threshold"
            value={config.gapOutThreshold}
            min={1}
            max={8}
            step={0.5}
            unit="s"
            onChange={(v) => onPatchConfig({ gapOutThreshold: v })}
          />
        </div>
      </Card>

      <Card
        title="Operator override"
        subtitle="Commands travel cloud to edge through the database queue, exactly as in a field deployment."
        action={overrideActive ? <Badge tone="warn" pulse>Manual</Badge> : <Badge tone="good">Auto</Badge>}
      >
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
            Warden passcode
          </span>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="OPERATOR_PASSCODE"
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-sky-500/50"
          />
        </label>

        <p className="mt-3 mb-2 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
          Force phase (20s hold)
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {PHASES.map((phase: PhaseId) => (
            <Button
              key={phase}
              disabled={busy}
              onClick={() => sendCommand({ action: "force_phase", phase, holdSeconds: 20 }, PHASE_LABELS[phase])}
              className="w-full"
            >
              {PHASE_LABELS[phase]}
            </Button>
          ))}
        </div>

        <div className="mt-3 flex gap-1.5">
          <Button
            disabled={busy}
            onClick={() => sendCommand({ action: "release" }, "Release to adaptive control")}
            className="flex-1"
          >
            Release to auto
          </Button>
        </div>

        <p className="mt-4 mb-2 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
          Dispatch emergency vehicle
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {(["N", "E", "S", "W"] as ApproachId[]).map((a) => (
            <Button
              key={a}
              variant="danger"
              disabled={busy}
              title={`${APPROACH_LABELS[a]} - queued via the cloud command channel`}
              onClick={() => sendCommand({ action: "emergency_preempt", approach: a }, `Emergency on ${a}`)}
            >
              {a}
            </Button>
          ))}
        </div>
        <button
          onClick={() => onLocalEmergency("N")}
          className="mt-2 w-full text-left text-[10px] text-[var(--color-ink-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-ink-dim)]"
        >
          Or inject one directly at the edge (skips the cloud round trip)
        </button>

        {status && (
          <p
            className={`mt-3 rounded-md border px-2.5 py-2 text-[11px] leading-snug ${
              status.tone === "good"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : status.tone === "warn"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
            }`}
          >
            {status.text}
          </p>
        )}
      </Card>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[11px]">
        <span className="text-[var(--color-ink-dim)]">{label}</span>
        <span className="tnum text-[var(--color-ink-faint)]">
          {value} {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full"
      />
    </label>
  );
}
