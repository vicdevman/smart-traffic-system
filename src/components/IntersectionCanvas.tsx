"use client";

import { useEffect, useRef } from "react";
import { INTERSECTION_WIDTH, splitLane } from "@/lib/sim/constants";
import type { ApproachId, SignalColor, SimSnapshot, Vehicle } from "@/lib/sim/types";

/**
 * Plan-view renderer for one four-way intersection.
 *
 * Geometry follows right-hand traffic: on each leg the two approaching lanes
 * sit on the right-hand half of the road, with the left-turn lane innermost
 * (against the centre line) and the through/right lane outboard. Vehicles are
 * drawn from their true simulated position, so what is on screen is the model
 * state rather than a decorative animation.
 */

const LANE_W = 17; // pixels per lane
const RENDER_RANGE_M = 130; // how far up each approach we draw

/** Unit forward vector for each approach, in screen coordinates (y grows down). */
const FORWARD: Record<ApproachId, [number, number]> = {
  N: [0, 1], // the north leg feeds traffic southbound
  S: [0, -1],
  E: [-1, 0],
  W: [1, 0],
};

const COLORS = {
  asphalt: "#161c29",
  asphaltEdge: "#212a3c",
  box: "#1a2130",
  marking: "#3d4a63",
  markingBright: "#7d8ba6",
  stopLine: "#c9d4e8",
  green: "#22c55e",
  amber: "#f5b301",
  red: "#ef4444",
  detect: "rgba(56,189,248,0.10)",
  detectActive: "rgba(56,189,248,0.20)",
};

const VEHICLE_COLORS: Record<string, string> = {
  car: "#8fa3c4",
  bus: "#e0a13a",
  truck: "#6d87ad",
  ambulance: "#f8fafc",
};

export function IntersectionCanvas({
  snapshot,
  size = 560,
  showDetectionZones = true,
}: {
  snapshot: SimSnapshot | null;
  size?: number;
  showDetectionZones?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const halfBox = LANE_W * 2;
    const scale = (size / 2 - halfBox) / RENDER_RANGE_M;

    drawRoads(ctx, size, cx, cy, halfBox);
    if (showDetectionZones) drawDetectionZones(ctx, snapshot, cx, cy, halfBox, scale);
    drawStopLines(ctx, snapshot, cx, cy, halfBox);
    drawVehicles(ctx, snapshot, cx, cy, halfBox, scale);
    drawSignalHeads(ctx, snapshot, cx, cy, halfBox);
    drawLabels(ctx, snapshot, size, cx, cy, halfBox);
  }, [snapshot, size, showDetectionZones]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="max-w-full rounded-xl border border-[var(--color-line)] bg-[#0a0e18]"
      role="img"
      aria-label="Live plan view of the simulated intersection"
    />
  );
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Perpendicular "right" vector for a forward vector. */
function rightOf([fx, fy]: [number, number]): [number, number] {
  return [-fy, fx];
}

/** Perpendicular "left" vector, used for the left-turn arc. */
function leftOf([fx, fy]: [number, number]): [number, number] {
  return [fy, -fx];
}

/** Centre-line offset of a lane from the road centre, in pixels. */
function laneOffset(movement: string): number {
  return movement === "left" ? LANE_W * 0.5 : LANE_W * 1.5;
}

/** Screen position of the stop line for a given lane. */
function stopPoint(
  approach: ApproachId,
  movement: string,
  cx: number,
  cy: number,
  halfBox: number,
): [number, number] {
  const f = FORWARD[approach];
  const r = rightOf(f);
  const off = laneOffset(movement);
  return [
    cx - f[0] * halfBox + r[0] * off,
    cy - f[1] * halfBox + r[1] * off,
  ];
}

/** Screen position of a vehicle, including its arc through the box. */
function vehiclePosition(
  v: Vehicle,
  cx: number,
  cy: number,
  halfBox: number,
  scale: number,
): { x: number; y: number; angle: number } {
  const { approach, movement } = splitLane(v.lane);
  const f = FORWARD[approach];
  const [sx, sy] = stopPoint(approach, movement, cx, cy, halfBox);

  if (v.dist > 0) {
    // Still upstream of the stop line: straight back along the approach.
    return {
      x: sx - f[0] * v.dist * scale,
      y: sy - f[1] * v.dist * scale,
      angle: Math.atan2(f[1], f[0]),
    };
  }

  const travelled = -v.dist; // metres past the stop line

  if (movement === "left") {
    // Sweep a quarter circle so left-turners visibly leave on the cross street.
    const p = Math.min(1, travelled / INTERSECTION_WIDTH);
    const theta = (p * Math.PI) / 2;
    const l = leftOf(f);
    const radius = halfBox * 1.15;
    const x = sx + f[0] * radius * Math.sin(theta) + l[0] * radius * (1 - Math.cos(theta));
    const y = sy + f[1] * radius * Math.sin(theta) + l[1] * radius * (1 - Math.cos(theta));
    const heading = Math.atan2(f[1], f[0]) + theta * turnSign(f, l);
    return { x, y, angle: heading };
  }

  return {
    x: sx + f[0] * travelled * scale,
    y: sy + f[1] * travelled * scale,
    angle: Math.atan2(f[1], f[0]),
  };
}

/** +1 or -1 depending on which way the left vector rotates from forward. */
function turnSign(f: [number, number], l: [number, number]): number {
  return f[0] * l[1] - f[1] * l[0] > 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawRoads(
  ctx: CanvasRenderingContext2D,
  size: number,
  cx: number,
  cy: number,
  halfBox: number,
) {
  const roadW = halfBox * 2;

  ctx.fillStyle = COLORS.asphalt;
  ctx.fillRect(cx - halfBox, 0, roadW, size);
  ctx.fillRect(0, cy - halfBox, size, roadW);

  ctx.strokeStyle = COLORS.asphaltEdge;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - halfBox + 0.5, 0, roadW - 1, size);
  ctx.strokeRect(0, cy - halfBox + 0.5, size, roadW - 1);

  // Intersection box, slightly lighter so the conflict area reads clearly.
  ctx.fillStyle = COLORS.box;
  ctx.fillRect(cx - halfBox, cy - halfBox, roadW, roadW);

  // Lane dividers between the two approaching lanes on each leg.
  ctx.strokeStyle = COLORS.marking;
  ctx.lineWidth = 1;
  ctx.setLineDash([7, 9]);
  const divider = LANE_W;
  for (const sign of [-1, 1]) {
    line(ctx, cx + sign * divider, 0, cx + sign * divider, cy - halfBox);
    line(ctx, cx + sign * divider, cy + halfBox, cx + sign * divider, size);
    line(ctx, 0, cy + sign * divider, cx - halfBox, cy + sign * divider);
    line(ctx, cx + halfBox, cy + sign * divider, size, cy + sign * divider);
  }
  ctx.setLineDash([]);

  // Solid centre lines separating the two directions of travel.
  ctx.strokeStyle = COLORS.markingBright;
  ctx.lineWidth = 1.4;
  line(ctx, cx, 0, cx, cy - halfBox);
  line(ctx, cx, cy + halfBox, cx, size);
  line(ctx, 0, cy, cx - halfBox, cy);
  line(ctx, cx + halfBox, cy, size, cy);
}

function drawDetectionZones(
  ctx: CanvasRenderingContext2D,
  snap: SimSnapshot,
  cx: number,
  cy: number,
  halfBox: number,
  scale: number,
) {
  for (const d of snap.detections) {
    const f = FORWARD[d.approach];
    const r = rightOf(f);
    const [sx, sy] = stopPoint(d.approach, d.movement, cx, cy, halfBox);
    const len = 100 * scale;

    // Rectangle covering the lane's detection zone, brightened when occupied.
    const halfW = LANE_W / 2 - 1;
    const ax = sx - f[0] * len;
    const ay = sy - f[1] * len;

    ctx.fillStyle = d.queueLength > 0 ? COLORS.detectActive : COLORS.detect;
    ctx.beginPath();
    ctx.moveTo(sx + r[0] * halfW, sy + r[1] * halfW);
    ctx.lineTo(sx - r[0] * halfW, sy - r[1] * halfW);
    ctx.lineTo(ax - r[0] * halfW, ay - r[1] * halfW);
    ctx.lineTo(ax + r[0] * halfW, ay + r[1] * halfW);
    ctx.closePath();
    ctx.fill();
  }
}

function drawStopLines(
  ctx: CanvasRenderingContext2D,
  snap: SimSnapshot,
  cx: number,
  cy: number,
  halfBox: number,
) {
  for (const d of snap.detections) {
    const f = FORWARD[d.approach];
    const r = rightOf(f);
    const [sx, sy] = stopPoint(d.approach, d.movement, cx, cy, halfBox);
    const halfW = LANE_W / 2 - 1;

    ctx.strokeStyle =
      d.signal === "green" ? COLORS.green : d.signal === "yellow" ? COLORS.amber : COLORS.stopLine;
    ctx.globalAlpha = d.signal === "red" ? 0.5 : 0.95;
    ctx.lineWidth = 2.5;
    line(
      ctx,
      sx + r[0] * halfW,
      sy + r[1] * halfW,
      sx - r[0] * halfW,
      sy - r[1] * halfW,
    );
    ctx.globalAlpha = 1;
  }
}

function drawVehicles(
  ctx: CanvasRenderingContext2D,
  snap: SimSnapshot,
  cx: number,
  cy: number,
  halfBox: number,
  scale: number,
) {
  const flash = Math.floor(snap.time * 4) % 2 === 0;

  for (const v of snap.vehicles) {
    if (v.dist > RENDER_RANGE_M) continue;

    const { x, y, angle } = vehiclePosition(v, cx, cy, halfBox, scale);
    const len = Math.max(6, v.length * scale);
    const wid = LANE_W - 6;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Body. The rectangle is drawn with its front bumper at the origin.
    ctx.fillStyle = v.isEmergency
      ? flash
        ? "#ffffff"
        : "#dbeafe"
      : VEHICLE_COLORS[v.vclass] ?? VEHICLE_COLORS.car;
    roundRect(ctx, -len, -wid / 2, len, wid, 2);
    ctx.fill();

    // A darker cabin band gives the vehicle an obvious facing direction.
    ctx.fillStyle = "rgba(6,10,18,0.45)";
    roundRect(ctx, -len * 0.42, -wid / 2 + 1, len * 0.3, wid - 2, 1);
    ctx.fill();

    if (v.isEmergency) {
      ctx.fillStyle = flash ? "#ef4444" : "#3b82f6";
      ctx.beginPath();
      ctx.arc(-len * 0.5, 0, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

function drawSignalHeads(
  ctx: CanvasRenderingContext2D,
  snap: SimSnapshot,
  cx: number,
  cy: number,
  halfBox: number,
) {
  (Object.keys(FORWARD) as ApproachId[]).forEach((approach) => {
    const f = FORWARD[approach];
    const r = rightOf(f);
    const aspects = snap.signals[approach];

    // Mount the head just outside the box on the near right-hand kerb.
    const baseX = cx - f[0] * (halfBox + 12) + r[0] * (halfBox + 11);
    const baseY = cy - f[1] * (halfBox + 12) + r[1] * (halfBox + 11);

    drawHead(ctx, baseX, baseY, aspects.through, aspects.left);
  });
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  through: SignalColor,
  left: SignalColor,
) {
  const w = 15;
  const h = 26;

  ctx.fillStyle = "#0b1018";
  ctx.strokeStyle = "#2a3448";
  ctx.lineWidth = 1;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 3);
  ctx.fill();
  ctx.stroke();

  lamp(ctx, x, y - 6, left, true);
  lamp(ctx, x, y + 6, through, false);
}

function lamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: SignalColor,
  isArrow: boolean,
) {
  const hex = color === "green" ? COLORS.green : color === "yellow" ? COLORS.amber : COLORS.red;

  ctx.save();
  ctx.shadowColor = hex;
  ctx.shadowBlur = 8;
  ctx.fillStyle = hex;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (isArrow) {
    // Small notch marking the head as the protected left-turn aspect.
    ctx.fillStyle = "rgba(6,10,18,0.75)";
    ctx.beginPath();
    ctx.moveTo(x - 2.2, y);
    ctx.lineTo(x + 1.2, y - 2.2);
    ctx.lineTo(x + 1.2, y + 2.2);
    ctx.closePath();
    ctx.fill();
  }
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  snap: SimSnapshot,
  size: number,
  cx: number,
  cy: number,
  halfBox: number,
) {
  ctx.font = "600 10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const totals: Record<ApproachId, number> = { N: 0, E: 0, S: 0, W: 0 };
  for (const d of snap.detections) totals[d.approach] += d.queueLength;

  const spots: Record<ApproachId, [number, number]> = {
    N: [cx - halfBox - 26, 20],
    S: [cx + halfBox + 26, size - 20],
    E: [size - 26, cy - halfBox - 20],
    W: [26, cy + halfBox + 20],
  };

  (Object.keys(spots) as ApproachId[]).forEach((a) => {
    const [x, y] = spots[a];
    const queued = totals[a];

    ctx.fillStyle = queued > 6 ? COLORS.red : queued > 0 ? COLORS.amber : "#4d5a73";
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#c8d3e8";
    ctx.fillText(a, x, y - 4);
    ctx.fillStyle = queued > 6 ? COLORS.red : "#8fa0bd";
    ctx.fillText(String(queued), x, y + 6);
  });

  // Preemption banner across the top of the view.
  if (snap.preemptionActive) {
    ctx.fillStyle = "rgba(239,68,68,0.9)";
    roundRect(ctx, cx - 90, 6, 180, 20, 5);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 10px ui-sans-serif, system-ui";
    ctx.fillText(
      `EMERGENCY PREEMPTION - ${snap.preemptionApproach ?? ""}`,
      cx,
      16,
    );
  }
}

// ---------------------------------------------------------------------------

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
