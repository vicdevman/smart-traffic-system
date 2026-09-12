import { NextResponse } from "next/server";
import { getBackend, listIntersections } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/intersections
 *
 * Fleet listing for the operations overview. On a fresh MongoDB cluster this
 * also seeds the three reference junctions so the dashboard is never empty.
 */
export async function GET() {
  const [intersections, backend] = await Promise.all([listIntersections(), getBackend()]);

  const now = Date.now();
  const decorated = intersections.map((i) => {
    // A junction that has not reported in 30 seconds is treated as offline,
    // mirroring the heartbeat rule a real deployment would use.
    const seen = i.lastSeenAt ? new Date(i.lastSeenAt).getTime() : 0;
    const staleness = seen ? (now - seen) / 1000 : Number.POSITIVE_INFINITY;
    const status = staleness > 30 ? "offline" : i.status;
    return { ...i, status, secondsSinceLastReport: Number.isFinite(staleness) ? Math.round(staleness) : null };
  });

  return NextResponse.json({
    ok: true,
    backend,
    count: decorated.length,
    intersections: decorated,
  });
}
