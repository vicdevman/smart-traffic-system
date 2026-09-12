/**
 * Seeds MongoDB with the reference intersections and a block of historical
 * telemetry, so the analytics page has something meaningful to show before any
 * live run has happened.
 *
 *   npm run seed
 *
 * Requires MONGODB_URI in .env.local. Without it the script exits with an
 * explanation rather than failing obscurely - the app itself does not need a
 * database to run.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    /* optional file */
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

if (!process.env.MONGODB_URI?.trim()) {
  console.error("");
  console.error("  MONGODB_URI is not set.");
  console.error("");
  console.error("  Seeding writes to MongoDB, so it needs a connection string. Copy");
  console.error("  .env.example to .env.local and set MONGODB_URI to your Atlas cluster.");
  console.error("");
  console.error("  You do not need a database to run the app - without one it falls back");
  console.error("  to an in-memory store and everything still works for a demo.");
  console.error("");
  process.exit(1);
}

async function main() {
  // Imported after the env check so the connection module reads a populated env.
  const { TrafficEngine } = await import("../src/lib/sim/engine");
  const { DEFAULT_CONFIG, SCENARIOS } = await import("../src/lib/sim/constants");
  const { Intersection, TrafficLog, Incident } = await import("../src/lib/db/models");
  const { connectToDatabase } = await import("../src/lib/db/mongoose");

  const conn = await connectToDatabase();
  if (!conn) {
    console.error("  Could not connect to MongoDB. Check MONGODB_URI and network access rules.");
    process.exit(1);
  }
  console.log("  Connected to MongoDB.");

  const intersections = [
    {
      intersectionId: "INT-001",
      name: "Ahmadu Bello Way / Herbert Macaulay Junction",
      location: { address: "Central Business District", latitude: 6.4531, longitude: 3.3958 },
      deviceId: "RPI-EDGE-001",
      approaches: ["N", "E", "S", "W"],
      controlMode: "adaptive" as const,
      status: "offline" as const,
      lastSeenAt: null,
      sensorsTotal: 8,
      sensorsOnline: 8,
    },
    {
      intersectionId: "INT-002",
      name: "University Road / Market Square",
      location: { address: "North Campus Gate", latitude: 6.5162, longitude: 3.3897 },
      deviceId: "RPI-EDGE-002",
      approaches: ["N", "E", "S", "W"],
      controlMode: "adaptive" as const,
      status: "offline" as const,
      lastSeenAt: null,
      sensorsTotal: 8,
      sensorsOnline: 7,
    },
    {
      intersectionId: "INT-003",
      name: "Airport Road / Ring Road Interchange",
      location: { address: "Southern Bypass", latitude: 6.4281, longitude: 3.4219 },
      deviceId: "RPI-EDGE-003",
      approaches: ["N", "E", "S", "W"],
      controlMode: "fixed" as const,
      status: "offline" as const,
      lastSeenAt: null,
      sensorsTotal: 8,
      sensorsOnline: 8,
    },
  ];

  for (const doc of intersections) {
    await Intersection().updateOne(
      { intersectionId: doc.intersectionId },
      { $set: doc },
      { upsert: true },
    );
  }
  console.log(`  Upserted ${intersections.length} intersections.`);

  // Generate a few hours of history by running the real engine and sampling it,
  // so the seeded data has the same statistical character as live telemetry.
  const HOURS = 3;
  const SAMPLE_EVERY_S = 30;
  const created: unknown[] = [];
  const incidents: unknown[] = [];

  for (const target of intersections) {
    const scenarioKey = target.intersectionId === "INT-002" ? "rushHour" : "balanced";
    const engine = new TrafficEngine(
      target.controlMode === "fixed" ? "fixed" : "adaptive",
      { ...DEFAULT_CONFIG, ...SCENARIOS[scenarioKey].patch, seed: 4242 },
    );

    const totalSamples = (HOURS * 3600) / SAMPLE_EVERY_S;
    const startedAt = Date.now() - HOURS * 3600 * 1000;

    for (let i = 0; i < totalSamples; i++) {
      // Advance in one-second slices so the engine integrates properly.
      for (let s = 0; s < SAMPLE_EVERY_S; s++) engine.advance(1);

      const snap = engine.getSnapshot();
      const idlePct =
        snap.metrics.totalGreenSeconds > 0
          ? (snap.metrics.idleGreenSeconds / snap.metrics.totalGreenSeconds) * 100
          : 0;

      created.push({
        intersectionId: target.intersectionId,
        deviceId: target.deviceId,
        recordedAt: new Date(startedAt + i * SAMPLE_EVERY_S * 1000),
        simTime: snap.time,
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
        health: { uptimeSeconds: Math.round(snap.time), sensorsOnline: target.sensorsOnline, sensorsTotal: 8 },
      });
    }

    const finalSnap = engine.getSnapshot();
    if (finalSnap.metrics.emergenciesServed > 0) {
      incidents.push({
        intersectionId: target.intersectionId,
        type: "emergency_preemption",
        severity: "critical",
        approach: "N",
        message: `${finalSnap.metrics.emergenciesServed} emergency vehicles given priority during the seeded window`,
        responseSeconds: Number(finalSnap.metrics.avgEmergencyResponse.toFixed(1)),
        occurredAt: new Date(startedAt + 1800 * 1000),
      });
    }

    console.log(
      `  Generated ${totalSamples} samples for ${target.intersectionId} (${scenarioKey}).`,
    );
  }

  await TrafficLog().deleteMany({});
  await TrafficLog().insertMany(created, { ordered: false });
  console.log(`  Inserted ${created.length} telemetry documents.`);

  if (incidents.length) {
    await Incident().insertMany(incidents, { ordered: false });
    console.log(`  Inserted ${incidents.length} incidents.`);
  }

  console.log("");
  console.log("  Seed complete. Open /analytics to see the historical reports.");
  console.log("");
  process.exit(0);
}

main().catch((error) => {
  console.error("  Seed failed:", error);
  process.exit(1);
});
