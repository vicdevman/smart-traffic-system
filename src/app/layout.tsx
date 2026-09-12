import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "STMS - Smart Traffic Management System",
    template: "%s | STMS",
  },
  description:
    "An online smart traffic management system: adaptive, density-responsive signal control with emergency preemption, live telemetry and a cloud operations dashboard.",
};

export const viewport: Viewport = {
  themeColor: "#070a12",
  width: "device-width",
  initialScale: 1,
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/dashboard", label: "Control Room" },
  { href: "/analytics", label: "Analytics" },
  { href: "/documentation", label: "Documentation" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-50 border-b border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-ground)_88%,transparent)] backdrop-blur-md">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 flex-col items-center justify-center gap-[3px] rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-signal-red)]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-signal-amber)]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-signal-green)]" />
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-semibold tracking-tight">STMS</span>
                <span className="block text-[10px] uppercase tracking-[0.16em] text-[var(--color-ink-faint)]">
                  Traffic Control
                </span>
              </span>
            </Link>

            <nav className="flex flex-1 flex-wrap items-center gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-[var(--color-ink-dim)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>

        <footer className="mt-16 border-t border-[var(--color-line)] px-4 py-8 sm:px-6">
          <div className="mx-auto max-w-[1600px] text-xs text-[var(--color-ink-faint)]">
            <p className="font-medium text-[var(--color-ink-dim)]">
              Smart Traffic Management System
            </p>
            {/* <p className="mt-1 max-w-3xl leading-relaxed">
              Final year project - design and implementation of an online smart traffic
              management system. The sensing layer is simulated; the control algorithm,
              telemetry pipeline, database tier and operations dashboard are production code.
            </p> */}
          </div>
        </footer>
      </body>
    </html>
  );
}
