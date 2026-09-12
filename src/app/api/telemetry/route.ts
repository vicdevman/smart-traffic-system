import { NextResponse } from "next/server";
import { checkDeviceKey } from "@/lib/auth";
import { extractBatch, ingestTelemetry } from "@/lib/telemetry";
import { getTrafficLogs } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

/**
 * POST /api/telemetry
 *
 * Ingest endpoint for edge controllers. Accepts a single telemetry document,
 * a bare array, or `{ batch: [...] }` - batching keeps the mobile data bill
 * down and lets a controller survive short connectivity outages by buffering.
 *
 * Requires the `x-device-key` header when DEVICE_API_KEY is configured.
 */
export async function POST(request: Request) {
  const authError = checkDeviceKey(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed JSON body" }, { status: 400 });
  }

  const raw = extractBatch(body);
  if (raw.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No telemetry documents supplied" },
      { status: 400 },
    );
  }
  if (raw.length > 200) {
    return NextResponse.json({ ok: false, error: "Batch too large (max 200)" }, { status: 413 });
  }

  const result = await ingestTelemetry(raw);

  if (result.accepted === 0) {
    return NextResponse.json(
      { ok: false, error: "No valid telemetry documents", problems: result.problems },
      { status: 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    accepted: result.accepted,
    rejected: result.rejected,
    problems: result.problems.length ? result.problems : undefined,
    serverTime: new Date().toISOString(),
  });
}

/**
 * GET /api/telemetry?intersectionId=INT-001&limit=120
 *
 * Time-series read used by the analytics page. Returned oldest-first so charts
 * can plot it without reversing.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const intersectionId = searchParams.get("intersectionId") ?? "INT-001";
  const limitRaw = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, limitRaw)) : 120;

  const logs = await getTrafficLogs(intersectionId, limit);

  return NextResponse.json({ ok: true, intersectionId, count: logs.length, logs });
}
