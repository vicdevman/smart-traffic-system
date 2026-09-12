/**
 * Virtual edge controller - a headless stand-in for the roadside Raspberry Pi.
 *
 * This process does exactly what the physical controller will do once the
 * hardware exists:
 *
 *   1. runs the adaptive signal control loop in real time,
 *   2. reads its sensors each cycle (here, from the traffic model),
 *   3. uploads batched telemetry to the cloud API using its device key,
 *   4. polls the cloud for operator override commands and applies them,
 *   5. acknowledges the commands it has carried out.
 *
 * Running it proves the API contract works against something other than the
 * browser, and it is the script you would diff against real firmware.
 *
 *   npm run virtual-edge
 *   npm run virtual-edge -- --url https://your-app.vercel.app --id INT-002
 *
 * Stop it with Ctrl+C.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TrafficEngine } from "../src/lib/sim/engine";
import { DEFAULT_CONFIG, SCENARIOS } from "../src/lib/sim/constants";
import type { ApproachId, PhaseId, TelemetryPayload } from "../src/lib/sim/types";

// ---------------------------------------------------------------------------
// Environment - read .env.local without pulling in a dependency
// ---------------------------------------------------------------------------

function loadEnvFile(filename: string): void {
  try {
    const contents = readFileSync(resolve(process.cwd(), filename), "utf8");
    for (const rawLine of contents.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env.local is fine - the defaults below cover a local demo.
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface Options {
  baseUrl: string;
  intersectionId: string;
  deviceId: string;
  scenario: string;
  uploadEverySeconds: number;
  pollEverySeconds: number;
  speed: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    baseUrl: process.env.STMS_URL ?? "http://localhost:3000",
    intersectionId: "INT-001",
    deviceId: "RPI-EDGE-001",
    scenario: "balanced",
    uploadEverySeconds: 5,
    pollEverySeconds: 4,
    speed: 1,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--url" && value) opts.baseUrl = value.replace(/\/$/, "");
    else if (flag === "--id" && value) opts.intersectionId = value;
    else if (flag === "--device" && value) opts.deviceId = value;
    else if (flag === "--scenario" && value) opts.scenario = value;
    else if (flag === "--speed" && value) opts.speed = Number(value);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Controller loop
// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
const deviceKey = process.env.DEVICE_API_KEY?.trim() ?? "";

const config = {
  ...DEFAULT_CONFIG,
  ...(SCENARIOS[opts.scenario]?.patch ?? {}),
  seed: Math.floor(Math.random() * 100000),
};

const engine = new TrafficEngine("adaptive", config);

let uploads = 0;
let failures = 0;
let lastTick = Date.now();
let startedAt = Date.now();

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(deviceKey ? { "x-device-key": deviceKey } : {}),
  };
}

function buildPayload(): TelemetryPayload {
  const snap = engine.getSnapshot();
  const idlePct =
    snap.metrics.totalGreenSeconds > 0
      ? (snap.metrics.idleGreenSeconds / snap.metrics.totalGreenSeconds) * 100
      : 0;

  return {
    intersectionId: opts.intersectionId,
    deviceId: opts.deviceId,
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
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      sensorsOnline: 8,
      sensorsTotal: 8,
    },
  };
}

async function uploadTelemetry(): Promise<void> {
  const payload = buildPayload();
  try {
    const res = await fetch(`${opts.baseUrl}/api/telemetry`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      console.error(
        "  [auth] Telemetry rejected: device key missing or wrong. Set DEVICE_API_KEY in .env.local " +
          "to the same value the server uses (or clear it on both sides for an open demo).",
      );
      failures++;
      return;
    }
    if (!res.ok) {
      console.error(`  [http] Telemetry rejected with status ${res.status}`);
      failures++;
      return;
    }

    uploads++;
    const snap = engine.getSnapshot();
    console.log(
      `  [${clock(snap.time)}] uploaded #${uploads} | phase ${snap.currentPhase.padEnd(11)} ` +
        `${snap.state.padEnd(8)} | queue ${String(snap.metrics.totalQueue).padStart(3)} | ` +
        `avg wait ${snap.metrics.avgWaitTime.toFixed(1)}s | served ${snap.metrics.vehiclesServed}`,
    );
  } catch (error) {
    failures++;
    console.error(
      `  [net] Upload failed: ${error instanceof Error ? error.message : String(error)}. ` +
        `Is the server running at ${opts.baseUrl}?`,
    );
  }
}

async function pollCommands(): Promise<void> {
  try {
    const res = await fetch(
      `${opts.baseUrl}/api/overrides?intersectionId=${encodeURIComponent(opts.intersectionId)}`,
      { headers: headers() },
    );
    if (!res.ok) return;

    const data = (await res.json()) as {
      commands: Array<{
        id: string;
        action: string;
        phase?: string;
        approach?: string;
        holdSeconds: number;
        issuedBy: string;
      }>;
    };
    if (!data.commands?.length) return;

    const applied: string[] = [];
    for (const cmd of data.commands) {
      if (cmd.action === "force_phase" && cmd.phase) {
        engine.forcePhase(cmd.phase as PhaseId, cmd.holdSeconds);
        console.log(`  [cmd] ${cmd.issuedBy} forced ${cmd.phase} for ${cmd.holdSeconds}s`);
      } else if (cmd.action === "release") {
        engine.clearOverride();
        console.log(`  [cmd] ${cmd.issuedBy} released manual control`);
      } else if (cmd.action === "emergency_preempt" && cmd.approach) {
        engine.injectEmergency(cmd.approach as ApproachId);
        console.log(`  [cmd] ${cmd.issuedBy} dispatched emergency on ${cmd.approach}`);
      }
      applied.push(cmd.id);
    }

    await fetch(`${opts.baseUrl}/api/overrides`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ ids: applied }),
    });
  } catch {
    // Losing the uplink must never stop the signal running. A real controller
    // keeps operating on local logic and reconnects when it can.
  }
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function tick(): void {
  const now = Date.now();
  const delta = ((now - lastTick) / 1000) * opts.speed;
  lastTick = now;
  engine.advance(delta);
}

async function main(): Promise<void> {
  console.log("");
  console.log("  STMS VIRTUAL EDGE CONTROLLER");
  console.log("  " + "=".repeat(60));
  console.log(`  Cloud endpoint  : ${opts.baseUrl}`);
  console.log(`  Intersection    : ${opts.intersectionId}`);
  console.log(`  Device ID       : ${opts.deviceId}`);
  console.log(`  Scenario        : ${SCENARIOS[opts.scenario]?.label ?? opts.scenario}`);
  console.log(`  Device auth     : ${deviceKey ? "device key present" : "none (open demo mode)"}`);
  console.log("");
  console.log("  Running the adaptive controller and uploading telemetry. Ctrl+C to stop.");
  console.log("");

  startedAt = Date.now();
  lastTick = Date.now();

  const simTimer = setInterval(tick, 100);
  const uploadTimer = setInterval(uploadTelemetry, opts.uploadEverySeconds * 1000);
  const pollTimer = setInterval(pollCommands, opts.pollEverySeconds * 1000);

  const shutdown = () => {
    clearInterval(simTimer);
    clearInterval(uploadTimer);
    clearInterval(pollTimer);
    const snap = engine.getSnapshot();
    console.log("");
    console.log("  Controller stopped.");
    console.log(
      `  Uploads: ${uploads} succeeded, ${failures} failed | vehicles served: ${snap.metrics.vehiclesServed} | ` +
        `avg wait: ${snap.metrics.avgWaitTime.toFixed(1)}s`,
    );
    console.log("");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Send one immediately so the dashboard lights up without waiting.
  await uploadTelemetry();
}

main();
