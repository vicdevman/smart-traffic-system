import { NextResponse } from "next/server";

/**
 * Minimal credential checks for the two classes of caller.
 *
 * Devices  present a shared secret in the `x-device-key` header. This models
 *          the per-device key a provisioned Raspberry Pi would hold.
 * Operators present the warden passcode in `x-operator-passcode` before any
 *          command that can change what a signal head displays.
 *
 * Both checks are skipped when the corresponding environment variable is
 * unset, which keeps the project runnable out of the box. Section 5 of the
 * documentation covers what must replace this before a field deployment
 * (mutual TLS, per-device certificates, and a real operator identity system).
 */

export function deviceKeyRequired(): boolean {
  return Boolean(process.env.DEVICE_API_KEY?.trim());
}

export function operatorPasscodeRequired(): boolean {
  return Boolean(process.env.OPERATOR_PASSCODE?.trim());
}

export function checkDeviceKey(request: Request): NextResponse | null {
  const expected = process.env.DEVICE_API_KEY?.trim();
  if (!expected) return null;

  const provided = request.headers.get("x-device-key")?.trim();
  if (provided !== expected) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing device key" },
      { status: 401 },
    );
  }
  return null;
}

export function checkOperator(request: Request): NextResponse | null {
  const expected = process.env.OPERATOR_PASSCODE?.trim();
  if (!expected) return null;

  const provided =
    request.headers.get("x-operator-passcode")?.trim() ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  if (provided !== expected) {
    return NextResponse.json(
      { ok: false, error: "Operator authentication required" },
      { status: 401 },
    );
  }
  return null;
}
