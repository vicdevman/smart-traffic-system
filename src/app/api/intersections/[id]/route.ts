import { NextResponse } from "next/server";
import { getIntersection, getTrafficLogs, listIncidents } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/intersections/:id
 *
 * Full detail view for one junction: its record, its most recent telemetry
 * sample, and the tail of its incident log.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const intersection = await getIntersection(id);
  if (!intersection) {
    return NextResponse.json(
      { ok: false, error: `Intersection ${id} not found` },
      { status: 404 },
    );
  }

  const [logs, incidents] = await Promise.all([
    getTrafficLogs(id, 60),
    listIncidents(id, 20),
  ]);

  return NextResponse.json({
    ok: true,
    intersection,
    latest: logs.length ? logs[logs.length - 1] : null,
    history: logs,
    incidents,
  });
}
