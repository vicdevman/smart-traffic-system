# Smart Traffic Management System (STMS)

**Design and Implementation of an Online Smart Traffic Management System**
Final year project — a density-responsive traffic signal controller with emergency vehicle
preemption, cloud telemetry, and a remote operations dashboard.

---

## What this is

A conventional traffic light runs a fixed cycle: it gives every approach the same green time
whether five vehicles are waiting or fifty. This system replaces that logic with a controller that
measures how many vehicles are actually queued and allocates green time accordingly, skips
approaches with nobody on them, ends a green early once the queue has discharged, and preempts the
whole cycle for emergency vehicles.

There is **no physical hardware in this build**. Rather than stubbing the sensors out with fake
numbers, the perception layer is replaced by a **microscopic traffic simulator**: individual
vehicles arrive as a Poisson process, follow a car-following law, form queues, and discharge at
realistic saturation flow. The controller reads that model through exactly the interface it would
use to read an IR sensor array.

**Everything from the sensor interface upwards is working software** — the control algorithm, the
telemetry API, the database tier, the operator command channel, the dashboard and the reporting
engine. The hardware slots into one clearly marked seam, documented in
[`docs/HARDWARE.md`](docs/HARDWARE.md).

### Why this is stronger than a mock-up

Because the vehicles are physically simulated, the system can be **measured**. A second controller
running fixed timings is stepped in lockstep on an *identical seeded arrival stream*, so both see
the same vehicles arriving at the same instants. The difference between them is an experimental
result under controlled conditions, not a claim.

```
npm run benchmark -- --minutes 12 --scenario lopsided
```

| Scenario | Avg wait (adaptive) | Avg wait (fixed) | Change | Vehicles served |
|---|---|---|---|---|
| Balanced flow | 19.3 s | 37.2 s | **−48.0%** | +5.0% |
| Morning rush | 39.8 s | 67.7 s | **−41.3%** | +22.8% |
| Lopsided demand | 17.8 s | 80.1 s | **−77.7%** | +49.6% |
| Off peak | 12.6 s | 29.8 s | **−57.7%** | +7.5% |
| Emergency drill | 38.4 s | 51.0 s | **−24.7%** | +15.5% |

The adaptive controller cuts waiting time in every scenario *while serving more vehicles*, which
rules out the obvious objection that it simply refuses traffic to flatter its averages.

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. **No database or configuration is required** — without a
`MONGODB_URI` the app falls back to an in-memory store and every feature still works.

To connect MongoDB and configure secrets, see **[SETUP.md](SETUP.md)**.

---

## The five things to look at

| Page / command | What it shows |
|---|---|
| `/dashboard` | The control room: live plan view, sensor readout, controller decision log, operator console, and the adaptive-vs-fixed comparison |
| `/analytics` | Planning reports read **back out of the database** through the API — proof the telemetry pipeline actually persisted |
| `/documentation` | Full system documentation, readable without cloning the repo |
| `npm run benchmark` | Reproducible headline numbers for the written report |
| `npm run virtual-edge` | A headless controller that uploads telemetry over HTTP — proof the API works against something other than the browser |

---

## How the control algorithm works

Four-phase, fully-actuated state machine. Phases serve opposing approaches together, which is how
real four-way junctions avoid conflicting movements while maximising throughput.

| Phase | Movements served |
|---|---|
| `NS_THROUGH` | North + South, through and right |
| `NS_LEFT` | North + South, protected left turns |
| `EW_THROUGH` | East + West, through and right |
| `EW_LEFT` | East + West, protected left turns |

**1. Green time proportional to density.** The report specifies *T ∝ D*. That is made physically
concrete — the time to discharge D vehicles is the startup lost time plus D saturation headways:

```
T = clamp(minGreen, startupLostTime + D × saturationHeadway, maxGreen)
T = clamp(8s,       2.0s + D × 2.0s,                         45s)
```

D is the *critical* (longest) queue among the lanes a phase serves, not their sum — the two lanes
discharge in parallel.

**2. Gap-out.** Once the minimum green is served and no vehicle has crossed the stop-bar detector
for the gap threshold, the queue has discharged and the green ends early. Every second recovered is
written to the decision log.

**3. Phase skipping.** A phase with no demand is not served at all. When nothing is waiting
anywhere else, the controller rests in its current green rather than cycling through empty
approaches. This is the largest single source of improvement over fixed timing.

**4. Starvation guard.** Skipping empty phases risks starving a light approach forever, so phase
selection scores three competing pressures:

```
score = queue
      + 0.12 × longestWaitInQueue
      + 0.06 × secondsSinceThisPhaseLastRan
      + 1000 if an emergency vehicle is present
```

**5. Emergency preemption.** The running green is truncated, the junction is cleared through yellow
and all-red, and the emergency corridor is held green until the vehicle passes — subject to a 30s
hold ceiling and an 18s cooldown so a stream of ambulances cannot starve the cross street.

> The ceiling and cooldown exist because of a real bug the benchmark caught: without them the
> adaptive controller served **64% fewer** vehicles than the baseline under the emergency drill,
> because back-to-back ambulances froze the north-south green. After the fix, the same scenario
> serves 15% *more*. This is documented rather than quietly patched, because the measurement
> catching it is the point.

---

## Architecture

Three tiers, matching the perception / network / application model:

```
┌─────────────────────────────────────────────────────────────┐
│ PERCEPTION   Traffic simulator → LaneDetection per lane     │  ← simulated
│              (queue, occupancy, stop-bar, wait, emergency)  │
└───────────────────────────┬─────────────────────────────────┘
                            │  the one seam hardware plugs into
┌───────────────────────────▼─────────────────────────────────┐
│ NETWORK      POST /api/telemetry   (batched, device key)    │  ← real
│              GET/PATCH /api/overrides  (command + ack)      │
└───────────────────────────┬─────────────────────────────────┘
┌───────────────────────────▼─────────────────────────────────┐
│ APPLICATION  Next.js routes → repository → MongoDB          │  ← real
│              Dashboard · Analytics · Audit trail · Reports  │
│                       └ in-memory fallback if no MONGODB_URI│
└─────────────────────────────────────────────────────────────┘
```

Operator commands are deliberately **not** applied directly in the browser. They are written to the
database, polled by the controller, applied, then acknowledged — so the latency visible on screen
is genuine command latency.

---

## Project structure

```
src/
├── lib/sim/                 The simulation kernel — pure TypeScript, no framework
│   ├── types.ts             Domain vocabulary (approach, lane, phase, detection)
│   ├── constants.ts         Physical parameters and demand scenarios
│   ├── random.ts            Seeded RNG — why the comparison is a controlled experiment
│   ├── controller.ts        The control strategies (pure functions of sensor readings)
│   └── engine.ts            Vehicle dynamics, virtual sensors, controller state machine
│
├── lib/db/
│   ├── mongoose.ts          Cached connection (serverless-safe)
│   ├── models.ts            Schemas for the four collections
│   └── repository.ts        Data access, with the in-memory fallback
│
├── lib/
│   ├── auth.ts              Device-key and operator-passcode checks
│   └── telemetry.ts         Shared validation + ingest
│
├── app/api/                 REST API (see docs/API.md)
├── app/dashboard/           The control room
├── app/analytics/           Planning reports
├── app/documentation/       In-app documentation
│
├── components/              Canvas renderer, charts, control panel, tables
└── hooks/useSimulation.ts   Animation loop, telemetry upload, command polling

scripts/
├── benchmark.ts             Headless adaptive-vs-fixed comparison
├── virtual-edge.ts          Headless controller that talks to the real API
└── seed.ts                  Populates MongoDB with reference data + history
```

The control algorithm in `src/lib/sim/controller.ts` is **pure and dependency-free** — it takes
sensor readings and returns decisions. That is what makes it portable to a Raspberry Pi unchanged.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run benchmark` | Adaptive vs fixed comparison. `-- --minutes 30 --scenario rushHour --seed 4242` |
| `npm run virtual-edge` | Headless edge controller. `-- --url https://your-app.vercel.app` |
| `npm run seed` | Populate MongoDB with reference intersections and history (needs `MONGODB_URI`) |

---

## Deployment

Deploys to Vercel with no configuration. Push the repository, import it, and add the environment
variables from [`.env.example`](.env.example) — all of which are optional. Full walkthrough in
[SETUP.md](SETUP.md).

---

## Documentation

| Document | Contents |
|---|---|
| [SETUP.md](SETUP.md) | Installation, MongoDB Atlas, environment variables, Vercel deployment, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, flowcharts, design decisions |
| [docs/API.md](docs/API.md) | Every endpoint with request and response examples |
| [docs/HARDWARE.md](docs/HARDWARE.md) | Bill of materials, GPIO map, wiring, the integration seam, remaining work |
| [docs/CHAPTER-MAPPING.md](docs/CHAPTER-MAPPING.md) | Maps every section of the written report to the code that implements it |
| `/documentation` (in-app) | The same material, readable in the deployed application |

---

## Limitations

Stated plainly, because a reviewer will ask:

- Single isolated junction — no green-wave coordination across a corridor.
- No pedestrian phases or push-button demand; minimum green stands in as a clearance proxy.
- Right turns share the through lane rather than having a dedicated movement.
- Arrivals are Poisson, which is realistic for free-flowing traffic but does not capture platoons
  released by an upstream signal.
- No weather, incident or road-works effects on sensor reliability.
- The in-memory fallback is per-instance, so a multi-instance deployment without MongoDB may serve
  inconsistent data between requests.
- Emergency vehicles are detected by a model flag, not by siren or strobe recognition — which is
  the harder half of the real problem.

**Nothing here is certified for use on a public road.** A deployed controller requires a hardware
conflict monitor that forces flashing red when conflicting greens are detected, independently of
the software.

---

## Technology

Next.js 16 (App Router) · TypeScript (strict) · MongoDB + Mongoose · Tailwind CSS v4 ·
HTML5 Canvas · hand-built SVG charts · Vercel

The charts are hand-built rather than taken from a library so the palette could be validated for
colour-vision deficiency — the two series colours were checked for perceptual separation against
the dark chart surface rather than picked by eye.
