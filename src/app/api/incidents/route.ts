import { NextResponse } from "next/server";
import { checkDeviceKey } from "@/lib/auth";
import { createIncident, listIncidents } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

const TYPES = [
  "emergency_preemption",
  "sensor_fault",
  "max_out",
  "manual_override",
  "congestion_alert",
] as const;

/**
 * GET /api/incidents?intersectionId=INT-001&limit=50
 *
 * The audit trail: emergency preemptions, forced overrides, sensor faults and
 * congestion alerts, newest first.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const intersectionId = searchParams.get("intersectionId") ?? undefined;
  const limitRaw = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;

  const incidents = await listIncidents(intersectionId, limit);
  return NextResponse.json({ ok: true, count: incidents.length, incidents });
}

/**
 * POST /api/incidents
 *
 * Raised by an edge controller when it preempts for an emergency vehicle, maxes
 * out a phase, or loses a sensor. Device-authenticated.
 */
export async function POST(request: Request) {
  const authError = checkDeviceKey(request);
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed JSON body" }, { status: 400 });
  }

  const intersectionId = String(body.intersectionId ?? "").trim();
  const type = String(body.type ?? "") as (typeof TYPES)[number];

  if (!intersectionId) {
    return NextResponse.json({ ok: false, error: "intersectionId is required" }, { status: 400 });
  }
  if (!TYPES.includes(type)) {
    return NextResponse.json(
      { ok: false, error: `type must be one of: ${TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  const severityRaw = String(body.severity ?? "info");
  const severity = (["info", "warning", "critical"].includes(severityRaw)
    ? severityRaw
    : "info") as "info" | "warning" | "critical";

  const incident = await createIncident({
    intersectionId,
    type,
    severity,
    approach: String(body.approach ?? ""),
    message: String(body.message ?? "").slice(0, 300),
    responseSeconds: Number(body.responseSeconds) || 0,
  });

  return NextResponse.json({ ok: true, incident }, { status: 201 });
}
