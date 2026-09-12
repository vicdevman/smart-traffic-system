import { NextResponse } from "next/server";
import { getBackend } from "@/lib/db/repository";
import { deviceKeyRequired, operatorPasscodeRequired } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Liveness and configuration probe. The dashboard calls this on load to decide
 * whether to show the "demo mode" banner, and it doubles as the endpoint a
 * monitoring service would poll.
 */
export async function GET() {
  const backend = await getBackend();

  return NextResponse.json({
    ok: true,
    service: "smart-traffic-management-system",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    storage: {
      backend,
      persistent: backend === "mongodb",
      note:
        backend === "mongodb"
          ? "Connected to MongoDB. Telemetry is durable."
          : "No MONGODB_URI configured - running on the in-memory store. Data is lost on restart.",
    },
    security: {
      deviceKeyEnforced: deviceKeyRequired(),
      operatorPasscodeEnforced: operatorPasscodeRequired(),
    },
  });
}
