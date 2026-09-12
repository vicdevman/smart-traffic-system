# Report Chapter Mapping

Maps every section of the written report to the part of the system that implements it, so that
each claim in the document can be demonstrated on screen or pointed at in the code.

---

## Chapter One — Introduction

| Section | Where it lives | Notes |
|---|---|---|
| 1.1 Background | `/` overview page | Framing of the problem |
| 1.2 Statement of the problem | `/` — "The problem, stated precisely" | Four problems, each measurable in the system |
| 1.3 Aim and objectives | See the objectives table below | All five objectives implemented |
| 1.4 Significance | `/analytics` recommendations; fuel and CO₂ metrics | Economic and environmental cost quantified |
| 1.5 Scope and limitation | README "Limitations"; `/documentation` §10 | Stated explicitly rather than glossed |
| 1.6 Definition of terms | `src/lib/sim/types.ts` | Every term is a documented type |

### Objectives

| Objective from §1.3 | Implementation | Evidence |
|---|---|---|
| Sensing module to detect vehicle density | `engine.ts :: refreshDetections()` | Sensor readout table on the dashboard |
| Cloud-based dashboard for remote monitoring | `/dashboard`, `/analytics` | Deployed on Vercel |
| Algorithm prioritising emergency vehicles | `engine.ts :: updateGreen()` preemption path | Dispatch an emergency and watch the log |
| Reduce average waiting time at intersections | `controller.ts` green allocation + gap-out | `npm run benchmark` — 25–78% reduction |
| *(implied)* Report on traffic for planning | `/api/reports/summary` | Peak hour, approach loading, recommendations |

---

## Chapter Two — Literature Review

| Concept from §2.1 | Status in this build |
|---|---|
| Computer vision (YOLO) for counting | **Not implemented.** The detection interface is vision-agnostic; a YOLO pipeline would populate the same `LaneDetection` records. Noted in HARDWARE.md §6. |
| Big data / historical pattern analysis | **Implemented.** `/api/reports/summary` builds an hourly demand profile and identifies the busiest clock hour. |
| Green wave coordination | **Not implemented.** Single isolated junction. The phase-selection interface would extend to it; listed as a limitation. |
| Inductive loops → modern detection | Discussed in HARDWARE.md §4, which compares loops, ultrasonic and radar. |

---

## Chapter Three — Methodology and System Analysis

| Section | Where it lives |
|---|---|
| 3.1 Methodology adopted (OOAD) | `TrafficEngine` class; `Vehicle`, `LaneDetection`, `SimConfig` as interacting objects |
| 3.2 System analysis (edge → cloud) | `docs/ARCHITECTURE.md` §1–2 |
| 3.3 Analysis of the existing system | `controller.ts` — the `fixed` strategy **is** the existing system, implemented and running |
| 3.4 Weakness of the existing system | Measured, not asserted — see below |
| 3.5 Analysis of the proposed system | `controller.ts` — the `adaptive` strategy |
| 3.6 Advantages of the proposed system | Comparison panel on `/dashboard`; `npm run benchmark` |
| 3.7 High-level model (three layers) | `docs/ARCHITECTURE.md` §1 |

### §3.4 — the weaknesses, quantified

The report lists three weaknesses of pre-timed control. Each is now a number rather than a claim:

| Weakness | Metric | Fixed | Adaptive |
|---|---|---|---|
| Inefficient use of road capacity | Idle green time (lopsided demand) | 29.1% | **5.6%** |
| Inefficient use of road capacity | Vehicles served (lopsided demand) | 343 | **513** |
| No intelligence to recognise emergencies | Emergency response time | 202.6 s | **30.0 s** |
| High maintenance cost of buried loops | — | Addressed by sensor choice in HARDWARE.md §4 |

---

## Chapter Four — System Design and Implementation

| Section | Where it lives |
|---|---|
| 4.1 Objective of design (minimise idle green) | `idleGreenSeconds` metric; gap-out and phase skipping |
| 4.2 System architecture in tiers | `docs/ARCHITECTURE.md` §1 |
| 4.3 Choice of programming environment | README "Technology"; `/documentation` §11 |
| 4.4 Database structure | `src/lib/db/models.ts` |
| 4.5 Database table definition | `docs/API.md`; `/documentation` §7 |
| 4.6 Input and output formats | `docs/API.md` |
| 4.7 Program algorithm | `/documentation` §3.6 pseudocode; `controller.ts` |
| 4.8 Program flowchart | `docs/ARCHITECTURE.md` §3 (Mermaid diagrams) |
| 4.9 Hardware requirements | `docs/HARDWARE.md` §3 |
| 4.10 Software requirements | Below |
| 4.11 Documentation | This directory, plus `/documentation` in the app |

### §4.3 — stack choice, and why it differs from the report

The report proposes Python/Flask with MySQL. This build uses **TypeScript, Next.js and MongoDB**.
The reasoning, which is worth being able to defend:

- **One codebase for API and dashboard.** Next.js route handlers and React pages share types, so a
  change to the telemetry payload is a compile error in the dashboard rather than a runtime
  surprise.
- **MongoDB over MySQL.** A telemetry sample is one document containing eight nested lane readings.
  In MySQL that is a join across two tables on every read; as a document it is one round trip. The
  workload is an append-heavy time series of nested records, which is what document stores are for.
- **TypeScript over Python.** Phase and lane identifiers are union types, so an invalid phase is a
  compile error. In a system where a wrong identifier means a conflicting green, that matters.
- **Vercel over Apache/Nginx.** Telemetry is bursty; serverless scales to it without a provisioned
  server, and deploys from a git push.

The report's Python/Raspberry Pi choice remains correct **for the edge device**. HARDWARE.md §6
covers porting `controller.ts` to Python, which is a transliteration because the module is pure.

### §4.7 — "T ∝ D", made concrete

The report states green time is proportional to density. The implementation makes the constant of
proportionality physically meaningful:

```
T = clamp(minGreen, startupLostTime + D × saturationHeadway, maxGreen)
T = clamp(8s,       2.0s + D × 2.0s,                         45s)
```

`D` is the *critical* (longest) queue among the lanes a phase serves, not their sum, because those
lanes discharge in parallel. Using the sum would systematically over-allocate green.

### §4.9 / §4.10 — requirements

**Hardware (for the eventual physical build):** see `docs/HARDWARE.md` §3.

**Hardware (to run this software):** any machine that runs Node.js 20+. No special hardware.

**Software:**

| Requirement | This build | Report's proposal |
|---|---|---|
| Runtime | Node.js 20+ | Python 3 on Raspbian |
| Framework | Next.js 16 | Flask / Django |
| Database | MongoDB 6+ (Atlas) | MySQL |
| Web server | Vercel (serverless) | Apache or Nginx |
| OS | any | Linux (Raspbian) on the edge |

---

## Chapter Five — Summary, Conclusion and Recommendations

### The performance claim

The report claims congestion is reduced "by up to 30% compared to fixed timers". That figure is now
**measured and reproducible**:

```bash
npm run benchmark -- --minutes 12 --scenario lopsided
```

| Scenario | Avg wait (adaptive) | Avg wait (fixed) | Reduction | Vehicles served |
|---|---|---|---|---|
| Balanced flow | 19.3 s | 37.2 s | 48.0% | +5.0% |
| Morning rush | 39.8 s | 67.7 s | 41.3% | +22.8% |
| Lopsided demand | 17.8 s | 80.1 s | 77.7% | +49.6% |
| Off peak | 12.6 s | 29.8 s | 57.7% | +7.5% |
| Emergency drill | 38.4 s | 51.0 s | 24.7% | +15.5% |

The measured reduction **exceeds** the 30% claim in four of five scenarios. Two caveats worth
stating in the report rather than leaving for an examiner to raise:

1. These are simulation results. Real junctions have pedestrians, illegal parking, turning conflicts
   and driver behaviour that no model captures fully. Field results would be lower.
2. The baseline is an un-optimised fixed timer with equal 25-second splits. A well-tuned fixed plan,
   retimed for the observed demand, would close part of the gap — though it could not respond to
   demand changing through the day, which is the entire point.

The honest framing: **the adaptive controller reduces delay substantially under every demand
pattern tested, and the advantage is largest precisely where fixed timing is weakest.**

### §5 — a bug worth reporting

The first implementation of emergency preemption had no hold ceiling and no cooldown. Under the
emergency drill scenario the adaptive controller served **64% fewer** vehicles than the fixed
baseline: back-to-back ambulances held the north–south green permanently and starved the cross
street completely. Average waiting time *looked* excellent (1.46 s) precisely because only the
favoured corridor was being served at all.

The benchmark harness caught it, because it reports throughput alongside delay. The fix — a 30 s
hold ceiling and an 18 s cooldown, both standard in real preemption units — turned a 64% throughput
deficit into a 15% surplus.

This is worth writing up because it demonstrates the value of the controlled-comparison design: a
dashboard alone would have shown a beautifully low waiting time and hidden the failure entirely.

### Recommendation from the report: "integrate AI for predictive modelling"

The groundwork is in place. `/api/reports/summary` already builds an hourly demand profile from
stored telemetry. A predictive extension would:

1. Train on the `traffic_logs` collection to forecast arrival rates per approach per time of day.
2. Feed the forecast into `computeGreenTime()` as a prior, so the controller anticipates a surge
   rather than reacting to it after the queue has formed.
3. Extend to corridor coordination, using predicted platoon arrival times to offset adjacent
   junctions — the green wave from §2.1.

---

## Quick demonstration map

| To show… | Do this |
|---|---|
| Density-responsive timing | Control room → Lopsided Demand → watch allocated green track the queue |
| Phase skipping | Same scenario → decision log shows "skipped N empty phase(s)" |
| Gap-out recovering green | Decision log → "Gap-out … Ns of green recovered" |
| Emergency preemption | Control panel → Dispatch emergency → N |
| Cloud-to-edge command latency | Force phase → note the delay before the log reacts |
| Persistence and reporting | `/analytics` after a minute of running |
| The API working without a browser | `npm run virtual-edge` |
| The performance claim | `npm run benchmark` |
| Honest scope | `/documentation` §9, §10 |
