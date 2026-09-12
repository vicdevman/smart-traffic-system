import type { ReactNode } from "react";

/** Shared presentational primitives used across the dashboard. */

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-line-soft)] px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[13px] font-semibold tracking-tight text-[var(--color-ink)]">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={`px-4 py-3 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  unit,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
}) {
  const toneClass = {
    neutral: "text-[var(--color-ink)]",
    good: "text-[var(--color-positive)]",
    warn: "text-[var(--color-signal-amber)]",
    bad: "text-[var(--color-negative)]",
    accent: "text-[var(--color-accent)]",
  }[tone];

  return (
    <div className="card-tight px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
        {label}
      </p>
      <p className={`mt-1 flex items-baseline gap-1 ${toneClass}`}>
        <span className="tnum text-xl font-semibold leading-none">{value}</span>
        {unit && (
          <span className="text-[11px] font-medium text-[var(--color-ink-faint)]">{unit}</span>
        )}
      </p>
      {hint && <p className="mt-1 text-[10px] leading-snug text-[var(--color-ink-faint)]">{hint}</p>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  pulse = false,
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
  pulse?: boolean;
}) {
  const map = {
    neutral: "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-dim)]",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    bad: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    accent: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.1em] ${map}`}
    >
      {pulse && <span className="pulse h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Meter({
  value,
  max,
  tone = "accent",
  label,
}: {
  value: number;
  max: number;
  tone?: "accent" | "good" | "warn" | "bad";
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const bar = {
    accent: "bg-sky-400",
    good: "bg-emerald-400",
    warn: "bg-amber-400",
    bad: "bg-rose-400",
  }[tone];

  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-[10px] text-[var(--color-ink-faint)]">
          <span>{label}</span>
          <span className="tnum">{value}</span>
        </div>
      )}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-line-soft)]"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? "level"}
      >
        <div className={`h-full rounded-full transition-[width] duration-300 ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SignalDot({ color, size = 10 }: { color: "red" | "yellow" | "green"; size?: number }) {
  const map = {
    red: "bg-[var(--color-signal-red)] shadow-[0_0_8px_var(--color-signal-red)]",
    yellow: "bg-[var(--color-signal-amber)] shadow-[0_0_8px_var(--color-signal-amber)]",
    green: "bg-[var(--color-signal-green)] shadow-[0_0_8px_var(--color-signal-green)]",
  }[color];
  return (
    <span
      className={`inline-block rounded-full ${map}`}
      style={{ width: size, height: size }}
      aria-label={`${color} signal`}
    />
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled = false,
  className = "",
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  const map = {
    default:
      "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:border-[#2c3a52]",
    primary:
      "border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25",
    danger: "border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25",
    ghost: "border-transparent bg-transparent text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]",
  }[variant];

  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${map} ${className}`}
    >
      {children}
    </button>
  );
}
