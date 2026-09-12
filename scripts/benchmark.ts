/**
 * Headless benchmark: adaptive control vs fixed-timer control.
 *
 * Runs both controllers over the same seeded arrival stream for a fixed
 * duration of simulated time and prints the comparison. This is the evidence
 * behind the performance claim in Chapter Five - re-run it with any seed and
 * the numbers reproduce exactly.
 *
 *   npm run benchmark
 *   npm run benchmark -- --minutes 30 --seed 4242 --scenario rushHour
 *
 * Because both engines are stepped in lockstep with identical seeds, they see
 * the same vehicles arriving at the same instants. The measured difference is
 * therefore attributable to the control strategy and nothing else.
 */

import { DEFAULT_CONFIG, SCENARIOS, TIME_STEP } from "../src/lib/sim/constants";
import { TrafficEngine } from "../src/lib/sim/engine";
import type { SimMetrics } from "../src/lib/sim/types";

interface Options {
  minutes: number;
  seed: number;
  scenario: string;
  warmupMinutes: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    minutes: 20,
    seed: DEFAULT_CONFIG.seed,
    scenario: "balanced",
    warmupMinutes: 2,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--minutes" && value) opts.minutes = Number(value);
    else if (flag === "--seed" && value) opts.seed = Number(value);
    else if (flag === "--scenario" && value) opts.scenario = value;
    else if (flag === "--warmup" && value) opts.warmupMinutes = Number(value);
  }

  if (!SCENARIOS[opts.scenario]) {
    console.error(
      `Unknown scenario "${opts.scenario}". Choose one of: ${Object.keys(SCENARIOS).join(", ")}`,
    );
    process.exit(1);
  }
  return opts;
}

function run(opts: Options) {
  const config = {
    ...DEFAULT_CONFIG,
    ...SCENARIOS[opts.scenario].patch,
    seed: opts.seed,
  };

  const adaptive = new TrafficEngine("adaptive", config);
  const fixed = new TrafficEngine("fixed", config);

  const totalSeconds = opts.minutes * 60;
  const steps = Math.round(totalSeconds / TIME_STEP);

  for (let i = 0; i < steps; i++) {
    adaptive.advance(TIME_STEP);
    fixed.advance(TIME_STEP);
  }

  return {
    config,
    adaptive: adaptive.getSnapshot().metrics,
    fixed: fixed.getSnapshot().metrics,
    simulatedSeconds: totalSeconds,
  };
}

function pct(reference: number, candidate: number): string {
  if (!Number.isFinite(reference) || reference === 0) return "n/a";
  const delta = ((reference - candidate) / reference) * 100;
  const sign = delta >= 0 ? "-" : "+";
  return `${sign}${Math.abs(delta).toFixed(1)}%`;
}

function idlePct(m: SimMetrics): number {
  return m.totalGreenSeconds > 0 ? (m.idleGreenSeconds / m.totalGreenSeconds) * 100 : 0;
}

function pad(text: string, width: number, align: "left" | "right" = "left"): string {
  return align === "left" ? text.padEnd(width) : text.padStart(width);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = run(opts);
  const a = result.adaptive;
  const f = result.fixed;

  const preset = SCENARIOS[opts.scenario];

  console.log("");
  console.log("  SMART TRAFFIC MANAGEMENT SYSTEM - CONTROL STRATEGY BENCHMARK");
  console.log("  " + "=".repeat(68));
  console.log(`  Scenario        : ${preset.label} - ${preset.description}`);
  console.log(`  Seed            : ${opts.seed}  (identical arrival stream for both controllers)`);
  console.log(`  Duration        : ${opts.minutes} minutes of simulated time`);
  console.log(`  Demand          : ${result.config.baseDemandVph} veh/h per approach, weighted`);
  console.log("");

  const rows: Array<[string, string, string, string]> = [
    [
      "Avg waiting time / vehicle",
      `${a.avgWaitTime.toFixed(2)} s`,
      `${f.avgWaitTime.toFixed(2)} s`,
      pct(f.avgWaitTime, a.avgWaitTime),
    ],
    [
      "Avg control delay / vehicle",
      `${a.avgDelay.toFixed(2)} s`,
      `${f.avgDelay.toFixed(2)} s`,
      pct(f.avgDelay, a.avgDelay),
    ],
    [
      "Max waiting time observed",
      `${a.maxWaitTime.toFixed(1)} s`,
      `${f.maxWaitTime.toFixed(1)} s`,
      pct(f.maxWaitTime, a.maxWaitTime),
    ],
    ["Avg stops / vehicle", a.avgStops.toFixed(2), f.avgStops.toFixed(2), pct(f.avgStops, a.avgStops)],
    [
      "Vehicles served",
      String(a.vehiclesServed),
      String(f.vehiclesServed),
      pct(f.vehiclesServed, a.vehiclesServed),
    ],
    [
      "Throughput",
      `${Math.round(a.throughputPerHour)} veh/h`,
      `${Math.round(f.throughputPerHour)} veh/h`,
      pct(f.throughputPerHour, a.throughputPerHour),
    ],
    [
      "Queue remaining at end",
      String(a.totalQueue),
      String(f.totalQueue),
      pct(f.totalQueue, a.totalQueue),
    ],
    [
      "Idle green time",
      `${idlePct(a).toFixed(1)} %`,
      `${idlePct(f).toFixed(1)} %`,
      pct(idlePct(f), idlePct(a)),
    ],
    [
      "Fuel burned idling",
      `${a.fuelWastedLitres.toFixed(2)} L`,
      `${f.fuelWastedLitres.toFixed(2)} L`,
      pct(f.fuelWastedLitres, a.fuelWastedLitres),
    ],
    [
      "CO2 from idling",
      `${a.co2Kg.toFixed(2)} kg`,
      `${f.co2Kg.toFixed(2)} kg`,
      pct(f.co2Kg, a.co2Kg),
    ],
  ];

  if (a.emergenciesServed > 0 && f.emergenciesServed > 0) {
    rows.push([
      "Emergency response time",
      `${a.avgEmergencyResponse.toFixed(1)} s`,
      `${f.avgEmergencyResponse.toFixed(1)} s`,
      pct(f.avgEmergencyResponse, a.avgEmergencyResponse),
    ]);
  }

  const W = [30, 14, 14, 10];
  console.log(
    "  " +
      pad("METRIC", W[0]) +
      pad("ADAPTIVE", W[1], "right") +
      pad("FIXED", W[2], "right") +
      pad("CHANGE", W[3], "right"),
  );
  console.log("  " + "-".repeat(W[0] + W[1] + W[2] + W[3]));

  for (const [label, adaptiveValue, fixedValue, change] of rows) {
    console.log(
      "  " +
        pad(label, W[0]) +
        pad(adaptiveValue, W[1], "right") +
        pad(fixedValue, W[2], "right") +
        pad(change, W[3], "right"),
    );
  }

  console.log("");
  const waitImprovement = ((f.avgWaitTime - a.avgWaitTime) / f.avgWaitTime) * 100;
  console.log(
    `  HEADLINE: adaptive control reduced average waiting time by ${waitImprovement.toFixed(1)}% ` +
      `and idle green time from ${idlePct(f).toFixed(1)}% to ${idlePct(a).toFixed(1)}%.`,
  );
  console.log("");
  console.log("  Note: 'CHANGE' is the adaptive result relative to the fixed-timer baseline.");
  console.log("  A negative value means the adaptive controller produced less of that quantity.");
  console.log("");
}

main();
