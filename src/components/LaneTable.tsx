"use client";

import { APPROACH_LABELS } from "@/lib/sim/constants";
import type { LaneDetection } from "@/lib/sim/types";
import { SignalDot } from "./ui";

/**
 * Live sensor readout - one row per lane.
 *
 * This is the raw feed the controller acts on. In the hardware build each row
 * corresponds to one IR/ultrasonic sensor pair reporting over GPIO; here the
 * values are derived from vehicle positions in the model. Nothing downstream
 * of this table knows the difference.
 */
export function LaneTable({ detections }: { detections: LaneDetection[] }) {
  const maxQueue = Math.max(1, ...detections.map((d) => d.queueLength));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[440px] border-collapse text-left">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">
            <th className="pb-2 font-medium">Lane</th>
            <th className="pb-2 font-medium">Signal</th>
            <th className="pb-2 text-right font-medium">Queue</th>
            <th className="pb-2 text-right font-medium">In zone</th>
            <th className="pb-2 text-right font-medium">Max wait</th>
            <th className="pb-2 pl-3 font-medium">Density</th>
          </tr>
        </thead>
        <tbody className="text-xs">
          {detections.map((d) => {
            const pct = (d.queueLength / maxQueue) * 100;
            const hot = d.queueLength >= 8;
            return (
              <tr
                key={d.laneId}
                className={`border-t border-[var(--color-line-soft)] ${
                  d.emergencyPresent ? "bg-rose-500/10" : ""
                }`}
              >
                <td className="py-1.5">
                  <span className="font-medium text-[var(--color-ink)]">
                    {APPROACH_LABELS[d.approach]}
                  </span>
                  <span className="ml-1.5 text-[10px] text-[var(--color-ink-faint)]">
                    {d.movement}
                  </span>
                  {d.emergencyPresent && (
                    <span className="ml-1.5 rounded bg-rose-500/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-300">
                      EMS
                    </span>
                  )}
                </td>
                <td className="py-1.5">
                  <SignalDot color={d.signal} size={9} />
                </td>
                <td className={`tnum py-1.5 text-right ${hot ? "text-rose-300" : "text-[var(--color-ink)]"}`}>
                  {d.queueLength}
                </td>
                <td className="tnum py-1.5 text-right text-[var(--color-ink-dim)]">{d.occupancy}</td>
                <td className="tnum py-1.5 text-right text-[var(--color-ink-dim)]">
                  {d.maxWait.toFixed(0)}s
                </td>
                <td className="py-1.5 pl-3">
                  <div className="h-1.5 w-full min-w-[60px] overflow-hidden rounded-full bg-[var(--color-line-soft)]">
                    <div
                      className={`h-full rounded-full transition-[width] duration-200 ${
                        d.signal === "green"
                          ? "bg-emerald-400"
                          : hot
                            ? "bg-rose-400"
                            : "bg-sky-400"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
