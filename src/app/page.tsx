import Link from "next/link";
import { Card } from "@/components/ui";

export default function HomePage() {
  return (
    <div className="space-y-10 pb-8">
      {/* ---- Hero ---------------------------------------------------------- */}
      <section className="pt-6">
        <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          Final year project
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          Design and Implementation of an Online Smart Traffic Management System
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-dim)]">
          A density-responsive traffic signal controller with emergency vehicle preemption, live
          cloud telemetry and a remote operations dashboard. The roadside sensing hardware is
          replaced by a microscopic traffic simulator; every other layer - the control algorithm,
          the ingest API, the database tier, the operator command channel - is working software.
        </p>

        <div className="mt-6 flex flex-wrap gap-2.5">
          <Link
            href="/dashboard"
            className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-4 py-2.5 text-sm font-medium text-sky-100 transition-colors hover:bg-sky-500/25"
          >
            Open the control room
          </Link>
          <Link
            href="/documentation"
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
          >
            Read the documentation
          </Link>
          <Link
            href="/analytics"
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
          >
            Planning analytics
          </Link>
        </div>
      </section>

      {/* ---- The argument -------------------------------------------------- */}
      <section>
        <h2 className="text-base font-semibold tracking-tight">The problem, stated precisely</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {PROBLEMS.map((p) => (
            <div key={p.title} className="card px-4 py-3.5">
              <p className="text-[13px] font-medium text-[var(--color-ink)]">{p.title}</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- How it works -------------------------------------------------- */}
      <section>
        <h2 className="text-base font-semibold tracking-tight">How the system works</h2>
        <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-[var(--color-ink-dim)]">
          Three tiers, matching the perception / network / application model in the report. The
          seam between tier one and tier two is a plain JSON contract, which is exactly why the
          simulator can stand in for hardware without the rest of the system noticing.
        </p>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {TIERS.map((tier, index) => (
            <Card key={tier.name} title={`${index + 1}. ${tier.name}`} subtitle={tier.role}>
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
                {tier.points.map((point) => (
                  <li key={point} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 rounded-md bg-[var(--color-surface-2)] px-2.5 py-2 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
                <strong className="text-[var(--color-ink-dim)]">In this build:</strong> {tier.status}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* ---- The algorithm ------------------------------------------------- */}
      <section>
        <h2 className="text-base font-semibold tracking-tight">
          What makes the control adaptive
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {MECHANISMS.map((m) => (
            <div key={m.title} className="card px-4 py-3.5">
              <p className="text-[13px] font-medium text-[var(--color-ink)]">{m.title}</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
                {m.body}
              </p>
              {m.formula && (
                <p className="tnum mt-2 rounded-md bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[10px] text-[var(--color-accent)]">
                  {m.formula}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---- Honesty section ------------------------------------------------ */}
      <section>
        <Card
          title="What is simulated, and what is not"
          subtitle="Stated plainly, because a reviewer will ask."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
                Real, working software
              </p>
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
                {REAL.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                Simulated, pending hardware
              </p>
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
                {SIMULATED.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            The hardware integration path is documented in full - wiring, GPIO pin map, the exact
            interface a Raspberry Pi must implement, and the provisioning steps - in the{" "}
            <Link href="/documentation" className="text-[var(--color-accent)] underline underline-offset-2">
              hardware roadmap
            </Link>
            .
          </p>
        </Card>
      </section>
    </div>
  );
}

const PROBLEMS = [
  {
    title: "Fixed timings",
    body: "A pre-timed controller holds green for an empty approach while a queue builds on the next one. The cycle repeats identically whether five vehicles are waiting or fifty.",
  },
  {
    title: "Emergency delays",
    body: "An ambulance held at a red light loses time that cannot be recovered. A legacy controller has no way to detect one, let alone respond.",
  },
  {
    title: "Environmental cost",
    body: "Every second of unnecessary idling burns fuel and emits CO2. The system measures both, so the saving is quantified rather than claimed.",
  },
  {
    title: "No data",
    body: "Manual traffic counts are expensive, infrequent and error-prone, which leaves planning decisions resting on guesswork.",
  },
];

const TIERS = [
  {
    name: "Perception layer",
    role: "Sensing vehicles at the kerb",
    points: [
      "Per-lane queue length, occupancy and longest wait",
      "Stop-bar detection driving gap-out decisions",
      "Emergency vehicle identification on approach",
    ],
    status:
      "A microscopic car-following model produces these readings from true vehicle positions. Swapping in real IR or ultrasonic sensors means replacing one method.",
  },
  {
    name: "Network layer",
    role: "Moving data and commands",
    points: [
      "Batched JSON telemetry uploaded to the cloud API",
      "Device-key authentication on ingest",
      "Operator commands polled and acknowledged by the edge",
    ],
    status:
      "Fully implemented over HTTPS. The command loop really does round-trip through the database, so the latency on screen is genuine.",
  },
  {
    name: "Application layer",
    role: "Storage, dashboard, reporting",
    points: [
      "MongoDB persistence with an in-memory fallback",
      "Live operations dashboard and audit trail",
      "Planning reports with peak-hour analysis",
    ],
    status:
      "Production code, deployed on Vercel. Runs with or without a database configured.",
  },
];

const MECHANISMS = [
  {
    title: "Green time proportional to density",
    body: "The time needed to discharge a queue of D vehicles is the startup lost time plus D saturation headways. The allocation is that figure, clamped between a pedestrian-clearance minimum and a starvation ceiling.",
    formula: "T = clamp(8s, 2.0s + D x 2.0s, 45s)",
  },
  {
    title: "Gap-out",
    body: "Once the minimum green has been served and no vehicle has crossed the stop-bar detector for the gap threshold, the queue has discharged and the green ends early. Every second recovered this way is logged.",
    formula: "terminate when headway > 3.0s and elapsed >= minGreen",
  },
  {
    title: "Phase skipping",
    body: "A phase with no demand is not served at all. This is the single largest source of the improvement over fixed timing, and it is what drives idle green time towards zero.",
    formula: null,
  },
  {
    title: "Emergency preemption",
    body: "When an emergency vehicle is detected on approach, the running green is truncated, the intersection is cleared through yellow and all-red, and the corridor is held green until the vehicle passes.",
    formula: null,
  },
  {
    title: "Starvation guard",
    body: "A movement ignored for longer than two maximum-green periods is promoted regardless of queue length, so a light approach can never be starved indefinitely by a heavy one.",
    formula: "score = queue + 0.12 x maxWait + 0.06 x timeSinceServed",
  },
  {
    title: "Measured, not asserted",
    body: "A second controller running fixed timings is stepped in lockstep on an identical seeded arrival stream. The difference between the two is the benefit of adaptive control, measured under controlled conditions.",
    formula: null,
  },
];

const REAL = [
  "The adaptive control algorithm, including gap-out, phase skipping, starvation protection and preemption",
  "The microscopic traffic model: Poisson arrivals, car-following dynamics, saturation-flow discharge",
  "REST API with request validation, device-key auth and batch telemetry ingest",
  "MongoDB schemas, indexes and the full data-access layer",
  "Operator command queue with cloud-to-edge delivery and acknowledgement",
  "Live dashboard, audit trail and planning reports",
  "Deployment configuration for Vercel",
];

const SIMULATED = [
  "IR / ultrasonic sensor hardware and its GPIO wiring",
  "Physical LED signal heads and their relay drivers",
  "The Raspberry Pi runtime (the browser plays this role in demo mode)",
  "Camera-based vehicle classification, which the roadmap covers as a future upgrade",
  "Weather effects on sensor reliability, noted as a limitation in the report",
];
