import { NextResponse } from "next/server";
import { extractBatch, ingestTelemetry } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

/**
 * POST /api/edge/telemetry
 *
 * Same-origin bridge for the in-browser edge simulator.
 *
 * Why this exists: /api/telemetry is authenticated with DEVICE_API_KEY, a
 * server-side secret that a browser must never hold. During a demo the browser
 * is standing in for the Raspberry Pi, so it uploads through this same-origin
 * route instead. Validation and storage are identical - only the credential
 * differs. A real deployment uses /api/telemetry with a provisioned key and
 * does not touch this route at all.
 */
export async function POST(request: Request) {
  // Reject cross-origin callers: this route is only for the app's own UI.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json(
          { ok: false, error: "Cross-origin requests must use /api/telemetry with a device key" },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid Origin header" }, { status: 400 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed JSON body" }, { status: 400 });
  }

  const raw = extractBatch(body);
  if (raw.length === 0 || raw.length > 200) {
    return NextResponse.json(
      { ok: false, error: "Batch must contain between 1 and 200 documents" },
      { status: 400 },
    );
  }

  const result = await ingestTelemetry(raw);
  return NextResponse.json({
    ok: result.accepted > 0,
    accepted: result.accepted,
    rejected: result.rejected,
  });
}
