import { NextResponse } from "next/server";
import { acknowledgeOverrides, listPendingOverrides } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

/**
 * Same-origin command channel for the in-browser edge simulator.
 *
 * GET   collects the operator instructions queued for a junction.
 * PATCH acknowledges the ones that have been applied.
 *
 * This mirrors /api/overrides (the device-authenticated equivalent) for the
 * same reason /api/edge/telemetry mirrors /api/telemetry: the browser cannot
 * hold the device secret. Reading a pending command list and acknowledging it
 * are both low-risk operations - nothing here can create a command, which
 * still requires the operator passcode on /api/overrides.
 */

function sameOriginGuard(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return null;
  try {
    if (new URL(origin).host !== host) {
      return NextResponse.json(
        { ok: false, error: "Cross-origin requests must use /api/overrides with a device key" },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid Origin header" }, { status: 400 });
  }
  return null;
}

export async function GET(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) return blocked;

  const { searchParams } = new URL(request.url);
  const intersectionId = searchParams.get("intersectionId") ?? "INT-001";
  const commands = await listPendingOverrides(intersectionId);

  return NextResponse.json({ ok: true, intersectionId, count: commands.length, commands });
}

export async function PATCH(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) return blocked;

  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 50) : [];
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "ids array is required" }, { status: 400 });
  }

  const acknowledged = await acknowledgeOverrides(ids);
  return NextResponse.json({ ok: true, acknowledged });
}
