"use client";

import type { SimEvent } from "@/lib/sim/types";

/**
 * Controller decision log.
 *
 * Every entry is a decision the algorithm actually made, with the reason it
 * made it - which phase was chosen and why, when a green gapped out and how
 * many seconds that recovered, when a preemption fired. During a defence this
 * is the fastest way to show that the controller is reasoning about demand
 * rather than running a fixed script.
 */
export function EventLog({ events }: { events: SimEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-[var(--color-ink-faint)]">
        No controller activity yet.
      </p>
    );
  }

  return (
    <ol className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
      {events.map((event) => (
        <li key={event.id} className="flex gap-2.5 rounded-md px-1.5 py-1 text-[11px] leading-snug">
          <span className="tnum shrink-0 pt-px text-[10px] text-[var(--color-ink-faint)]">
            {formatClock(event.time)}
          </span>
          <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dotFor(event.level)}`} />
          <span className={textFor(event.level)}>{event.message}</span>
        </li>
      ))}
    </ol>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function dotFor(level: SimEvent["level"]): string {
  return {
    info: "bg-sky-400/70",
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    critical: "bg-rose-400",
  }[level];
}

function textFor(level: SimEvent["level"]): string {
  return {
    info: "text-[var(--color-ink-dim)]",
    success: "text-emerald-300",
    warning: "text-amber-300",
    critical: "font-medium text-rose-300",
  }[level];
}
