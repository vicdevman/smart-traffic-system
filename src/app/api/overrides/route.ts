import { NextResponse } from "next/server";
import { checkDeviceKey, checkOperator, operatorPasscodeRequired } from "@/lib/auth";
import {
  acknowledgeOverrides,
  createIncident,
  createOverride,
  listPendingOverrides,
} from "@/lib/db/repository";

export const dynamic = "force-dynamic";

const ACTIONS = ["force_phase", "release", "set_mode", "emergency_preempt"] as const;
const PHASES = ["NS_THROUGH", "NS_LEFT", "EW_THROUGH", "EW_LEFT"] as const;

/**
 * POST /api/overrides
 *
 * A traffic warden issues a command from the dashboard. The command is queued
 * in the database rather than applied directly, because in the field the cloud
 * cannot reach the edge controller synchronously - the controller polls for
 * pending instructions and acknowledges them. The simulator follows exactly
 * the same handshake, so the control path is real.
 *
 * Requires `x-operator-passcode` when OPERATOR_PASSCODE is configured.
 */
export async function POST(request: Request) {
  const authError = checkOperator(request);
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed JSON body" }, { status: 400 });
  }

  const intersectionId = String(body.intersectionId ?? "").trim();
  if (!intersectionId) {
    return NextResponse.json({ ok: false, error: "intersectionId is required" }, { status: 400 });
  }

  const action = String(body.action ?? "") as (typeof ACTIONS)[number];
  if (!ACTIONS.includes(action)) {
    return NextResponse.json(
      { ok: false, error: `action must be one of: ${ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const phase = body.phase ? String(body.phase) : undefined;
  if (action === "force_phase") {
    if (!phase || !PHASES.includes(phase as (typeof PHASES)[number])) {
      return NextResponse.json(
        { ok: false, error: `force_phase requires phase to be one of: ${PHASES.join(", ")}` },
        { status: 400 },
      );
    }
  }

  const approach = body.approach ? String(body.approach) : undefined;
  if (action === "emergency_preempt" && !["N", "E", "S", "W"].includes(approach ?? "")) {
    return NextResponse.json(
      { ok: false, error: "emergency_preempt requires approach to be N, E, S or W" },
      { status: 400 },
    );
  }

  const holdSeconds = Math.min(120, Math.max(5, Number(body.holdSeconds) || 20));
  const issuedBy = String(body.issuedBy ?? "operator").slice(0, 64);

  const record = await createOverride({
    intersectionId,
    action,
    phase,
    approach,
    mode: body.mode ? String(body.mode) : undefined,
    holdSeconds,
    issuedBy,
  });

  // Every manual intervention is written to the audit trail.
  await createIncident({
    intersectionId,
    type: action === "emergency_preempt" ? "emergency_preemption" : "manual_override",
    severity: action === "emergency_preempt" ? "critical" : "warning",
    approach: approach ?? "",
    message:
      action === "force_phase"
        ? `Operator ${issuedBy} forced phase ${phase} for ${holdSeconds}s`
        : action === "emergency_preempt"
          ? `Operator ${issuedBy} triggered emergency preemption on ${approach}`
          : action === "release"
            ? `Operator ${issuedBy} released manual control`
            : `Operator ${issuedBy} set control mode to ${body.mode}`,
    responseSeconds: 0,
  });

  return NextResponse.json({ ok: true, command: record }, { status: 201 });
}

/**
 * GET /api/overrides?intersectionId=INT-001
 *
 * Polled by the edge controller to collect instructions waiting for it.
 * Authenticated with the device key, not the operator passcode.
 */
export async function GET(request: Request) {
  const authError = checkDeviceKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const intersectionId = searchParams.get("intersectionId") ?? "INT-001";
  const commands = await listPendingOverrides(intersectionId);

  return NextResponse.json({
    ok: true,
    intersectionId,
    count: commands.length,
    commands,
    operatorAuthEnforced: operatorPasscodeRequired(),
  });
}

/**
 * PATCH /api/overrides
 *
 * The edge controller confirms it has applied the listed commands, closing the
 * loop so they are not delivered twice.
 */
export async function PATCH(request: Request) {
  const authError = checkDeviceKey(request);
  if (authError) return authError;

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
