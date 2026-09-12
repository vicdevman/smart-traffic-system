import type { Metadata } from "next";
import { Card } from "@/components/ui";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "System documentation for the Smart Traffic Management System: architecture, algorithm, API reference, database schema, operating guide and hardware roadmap.",
};

/**
 * In-app documentation.
 *
 * Kept in the application itself rather than only in the repository so that a
 * reviewer opening the deployed URL can read how the system works without
 * cloning anything. The Markdown files under /docs carry the same material in
 * a form that can be pasted into the written report.
 */
export default function DocumentationPage() {
  return (
    <div className="space-y-8 pb-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">System Documentation</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-dim)]">
          What was built, how it works, how to run it, and precisely what remains for the hardware
          build. The same material is in the repository under{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 text-[12px]">/docs</code>.
        </p>
      </header>

      <Nav />

      <Section id="overview" title="1. What this system is">
        <P>
          The Smart Traffic Management System (STMS) is a density-responsive traffic signal
          controller with emergency vehicle preemption, cloud telemetry and a remote operations
          dashboard. It replaces the fixed-timer logic of a conventional junction with a controller
          that measures how many vehicles are actually waiting and allocates green time accordingly.
        </P>
        <P>
          The project has no physical hardware. Instead of stubbing the sensors out, the perception
          layer is replaced with a <Em>microscopic traffic simulator</Em>: individual vehicles
          arrive as a Poisson process, follow a car-following law, form queues, and discharge at
          realistic saturation flow. The controller reads that model through the same interface it
          would use to read an IR sensor array. Everything from the sensor interface upwards is
          working software.
        </P>
        <Callout tone="good" title="Why this is stronger than a mock-up">
          Because the vehicles are physically simulated, the system can be <Em>measured</Em>. A
          second controller running fixed timings is stepped in lockstep on an identical seeded
          arrival stream, so the performance difference between the two is an experimental result
          under controlled conditions rather than an assertion.
        </Callout>
      </Section>

      <Section id="architecture" title="2. Architecture">
        <P>Three tiers, matching the perception / network / application model:</P>
        <Table
          head={["Tier", "Responsibility", "Implementation", "Status"]}
          rows={[
            [
              "Perception",
              "Detect vehicles, queues and emergency vehicles per lane",
              "Traffic simulator producing LaneDetection records",
              "Simulated",
            ],
            [
              "Network",
              "Carry telemetry up and commands down",
              "HTTPS JSON, device-key auth, batch upload, command polling",
              "Real",
            ],
            [
              "Application",
              "Store, visualise, report, control",
              "Next.js App Router, MongoDB via Mongoose, React dashboard",
              "Real",
            ],
          ]}
        />
        <P>
          The boundary between tier one and tier two is a plain JSON contract. That is the single
          most important design decision in the project: it is what allows a Raspberry Pi to be
          dropped in later without touching the algorithm, the API, the database or the dashboard.
        </P>

        <SubTitle>Request flow</SubTitle>
        <Pre>{`Edge controller (simulated)
   |
   |  POST /api/telemetry          every 5s, batched, x-device-key
   v
Next.js route handler  ->  validation  ->  repository  ->  MongoDB
                                              |
                                              +--> in-memory store if no MONGODB_URI
   ^
   |  GET /api/overrides           polled every 4s by the controller
   |  PATCH /api/overrides         acknowledgement
   |
Operator dashboard  --POST /api/overrides-->  command queue`}</Pre>
        <P>
          Operator commands are deliberately <Em>not</Em> applied directly in the browser. They are
          written to the database, polled by the controller, applied, and then acknowledged. The
          delay visible on screen is genuine command latency, which is what a warden would
          experience in the field.
        </P>
      </Section>

      <Section id="algorithm" title="3. The control algorithm">
        <P>
          The controller is a four-phase, fully-actuated state machine. Phases serve opposing
          approaches together, which is how real four-way junctions avoid conflicting movements
          while maximising throughput.
        </P>
        <Table
          head={["Phase", "Movements served"]}
          rows={[
            ["NS_THROUGH", "North and South, through and right turns"],
            ["NS_LEFT", "North and South, protected left turns"],
            ["EW_THROUGH", "East and West, through and right turns"],
            ["EW_LEFT", "East and West, protected left turns"],
          ]}
        />

        <SubTitle>3.1 Green time proportional to density</SubTitle>
        <P>
          The report specifies <Em>T proportional to D</Em>. That is made physically concrete: the
          time needed to discharge a queue of D vehicles is the startup lost time plus D saturation
          headways, clamped between a pedestrian-clearance minimum and a starvation ceiling.
        </P>
        <Pre>{`T = clamp(minGreen, startupLostTime + D x saturationHeadway, maxGreen)
T = clamp(8s,       2.0s + D x 2.0s,                           45s)

D is the critical (longest) queue among the lanes the phase serves,
not their sum - the two lanes discharge in parallel.`}</Pre>

        <SubTitle>3.2 Gap-out</SubTitle>
        <P>
          Once the minimum green has been served and no vehicle has crossed the stop-bar detector
          for the gap threshold, the queue has discharged and the green ends early. Every second
          recovered this way is written to the decision log.
        </P>

        <SubTitle>3.3 Phase skipping</SubTitle>
        <P>
          A phase with no demand is not served at all. When nothing is waiting anywhere else, the
          controller rests in its current green rather than cycling through empty approaches. This
          is the single largest source of improvement over fixed timing.
        </P>

        <SubTitle>3.4 Starvation guard</SubTitle>
        <P>
          Skipping empty phases risks starving a light approach forever, so phase selection scores
          three competing pressures and a movement ignored for more than two maximum-green periods
          is promoted regardless of queue length.
        </P>
        <Pre>{`score = queue
      + 0.12 x longestWaitInQueue
      + 0.06 x secondsSinceThisPhaseLastRan
      + 1000 if an emergency vehicle is present`}</Pre>

        <SubTitle>3.5 Emergency preemption</SubTitle>
        <P>
          When an emergency vehicle enters the detection zone, the running green is truncated, the
          junction is cleared through yellow and all-red, and the emergency corridor is held green
          until the vehicle passes. Two safeguards prevent this from becoming a denial of service on
          the cross street:
        </P>
        <Bullets
          items={[
            "A hold ceiling of 30 seconds. A sustained stream of emergency vehicles cannot freeze the cycle indefinitely.",
            "A cooldown of 18 seconds between preemptions. During the cooldown an emergency still wins phase selection outright through its scoring bonus - it simply cannot halt the current green.",
          ]}
        />
        <Callout tone="warn" title="This was a real bug, found by measurement">
          The first implementation had no ceiling or cooldown. Under the emergency drill scenario
          the adaptive controller served 64% <Em>fewer</Em> vehicles than the fixed baseline, because
          back-to-back ambulances held the north-south green permanently and starved the cross
          street. The benchmark harness caught it. After the fix the same scenario serves 15% more
          vehicles than the baseline.
        </Callout>

        <SubTitle>3.6 Program algorithm (pseudocode)</SubTitle>
        <Pre>{`initialise all approaches to RED
current <- NS_THROUGH,  state <- GREEN

every 0.1 s:
    generate arrivals per lane (Poisson)
    read sensors -> queue, occupancy, stop-bar, longest wait, emergency flag

    case state of
      GREEN:
        if emergency detected and cooldown expired:
            begin preemption, cut to YELLOW toward the emergency phase
        else if preemption held longer than 30 s:
            end preemption, arm cooldown
        else if operator override is holding this phase:
            stay
        else if elapsed >= maxGreen:                  -> YELLOW  (max-out)
        else if elapsed >= minGreen and headway > gap: -> YELLOW  (gap-out)
        else if elapsed >= allocated and no queue:     -> YELLOW
      YELLOW:
        if elapsed >= yellowTime:  -> ALL_RED
      ALL_RED:
        if elapsed >= allRedTime:
            next    <- highest scoring phase with demand
            allocated <- clamp(minGreen, lost + D x headway, maxGreen)
            current <- next,  state <- GREEN

    advance every vehicle under the car-following law
    accumulate delay, stops, throughput, idle green, fuel, CO2`}</Pre>
      </Section>

      <Section id="model" title="4. The traffic model">
        <P>
          Vehicle motion uses a safe-speed car-following rule. Each vehicle computes the distance it
          may advance - bounded by its leader&apos;s rear bumper and, if the signal forbids entry, by
          the stop line - then takes the fastest speed from which it could still stop within that
          distance.
        </P>
        <Pre>{`allowed  = min( leader.dist - leader.length - minGap,
                distanceToStopLine if the signal forbids entry )

safeSpeed = sqrt( 2 x deceleration x allowed )
speed     = min( freeFlowSpeed x classFactor, safeSpeed )
            bounded by comfortable acceleration and braking rates`}</Pre>
        <P>
          This one rule reproduces queue build-up, the startup wave at the beginning of green, and
          saturation-flow discharge, without any of them being scripted.
        </P>
        <Table
          head={["Parameter", "Value", "Source"]}
          rows={[
            ["Free-flow speed", "13.9 m/s (50 km/h)", "Urban default"],
            ["Saturation headway", "2.0 s", "~1800 veh/h/lane"],
            ["Startup lost time", "2.0 s", "Driver reaction at green"],
            ["Comfortable acceleration", "2.2 m/s²", "Passenger comfort"],
            ["Comfortable deceleration", "3.5 m/s²", "Passenger comfort"],
            ["Minimum stopped gap", "2.0 m", "Bumper to bumper"],
            ["Detection zone", "120 m upstream", "Sensor array reach"],
            ["Idle fuel burn", "0.7 L/h", "Idling petrol engine"],
            ["CO₂ per litre", "2.31 kg", "Petrol combustion"],
          ]}
        />
      </Section>

      <Section id="measurement" title="5. How performance is measured">
        <P>
          Two engines are constructed with the same seed and stepped in lockstep. Because arrival
          generation consumes the random stream in a fixed order, both receive identical vehicles at
          identical instants. The only difference is the control strategy.
        </P>
        <Pre>{`npm run benchmark
npm run benchmark -- --minutes 30 --scenario lopsided --seed 4242`}</Pre>
        <P>Representative results over 12 simulated minutes per scenario:</P>
        <Table
          head={["Scenario", "Avg wait (adaptive)", "Avg wait (fixed)", "Change", "Vehicles served"]}
          rows={[
            ["Balanced flow", "19.3 s", "37.2 s", "-48.0%", "+5.0%"],
            ["Morning rush", "39.8 s", "67.7 s", "-41.3%", "+22.8%"],
            ["Lopsided demand", "17.8 s", "80.1 s", "-77.7%", "+49.6%"],
            ["Off peak", "12.6 s", "29.8 s", "-57.7%", "+7.5%"],
            ["Emergency drill", "38.4 s", "51.0 s", "-24.7%", "+15.5%"],
          ]}
        />
        <P>
          The adaptive controller reduces waiting time in every scenario while serving <Em>more</Em>{" "}
          vehicles, which rules out the obvious objection that it simply refuses traffic to keep its
          averages low. The gain is largest under lopsided demand, which is exactly where a fixed
          timer wastes the most green.
        </P>
        <Callout tone="info" title="On the metrics">
          Idle green time counts green displayed to an empty approach <Em>while another approach has
          vehicles waiting</Em>. A controller resting in green on a deserted junction at 3am wastes
          nothing, because there is nobody else to serve; counting that as waste would flatter the
          fixed baseline and misrepresent both systems.
        </Callout>
      </Section>

      <Section id="api" title="6. API reference">
        <Table
          head={["Method & path", "Auth", "Purpose"]}
          rows={[
            ["GET /api/health", "none", "Liveness, storage backend, security configuration"],
            ["GET /api/intersections", "none", "Fleet listing with heartbeat-derived status"],
            ["GET /api/intersections/:id", "none", "One junction plus latest telemetry and incidents"],
            ["POST /api/telemetry", "device key", "Ingest one document or a batch of up to 200"],
            ["GET /api/telemetry", "none", "Time series for charts, oldest first"],
            ["POST /api/overrides", "operator passcode", "Queue an operator command"],
            ["GET /api/overrides", "device key", "Controller collects pending commands"],
            ["PATCH /api/overrides", "device key", "Controller acknowledges applied commands"],
            ["GET /api/incidents", "none", "Audit trail, newest first"],
            ["POST /api/incidents", "device key", "Controller raises an incident"],
            ["GET /api/reports/summary", "none", "Planning report with peak analysis and advice"],
          ]}
        />
        <P>
          Two additional routes,{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 text-[12px]">
            /api/edge/telemetry
          </code>{" "}
          and{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 text-[12px]">
            /api/edge/commands
          </code>
          , exist only for the in-browser simulator. A browser cannot safely hold the device secret,
          so these same-origin routes stand in for a provisioned device during a demo. They perform
          identical validation and write to the identical store. A real controller uses the
          device-authenticated routes and never touches them.
        </P>

        <SubTitle>Telemetry payload</SubTitle>
        <Pre>{`POST /api/telemetry
x-device-key: <DEVICE_API_KEY>

{
  "intersectionId": "INT-001",
  "deviceId": "RPI-EDGE-001",
  "recordedAt": "2026-09-11T00:23:41.488Z",
  "simTime": 120.4,
  "mode": "adaptive",
  "currentPhase": "NS_THROUGH",
  "signalState": "GREEN",
  "lanes": [
    { "laneId": "N-through", "approach": "N", "movement": "through",
      "vehicleCount": 7, "queueLength": 5, "maxWait": 18.3, "signal": "green" }
  ],
  "metrics": { "avgWaitTime": 19.4, "totalQueue": 9,
               "throughputPerHour": 2148, "vehiclesServed": 54,
               "idleGreenPct": 3.3 },
  "health": { "uptimeSeconds": 120, "sensorsOnline": 8, "sensorsTotal": 8 }
}`}</Pre>
      </Section>

      <Section id="database" title="7. Database schema">
        <P>
          MongoDB, four collections. If{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 text-[12px]">MONGODB_URI</code>{" "}
          is absent the repository transparently falls back to a bounded in-memory store, so the
          application is fully demonstrable with no infrastructure at all.
        </P>

        <SubTitle>traffic_logs</SubTitle>
        <Table
          head={["Field", "Type", "Description"]}
          rows={[
            ["_id", "ObjectId", "Primary key"],
            ["intersectionId", "String (indexed)", "Which junction reported"],
            ["deviceId", "String", "Which controller reported"],
            ["recordedAt", "Date (indexed)", "Wall-clock time of the reading"],
            ["simTime", "Number", "Controller uptime in seconds"],
            ["mode", "String", "adaptive | fixed"],
            ["currentPhase", "String", "Phase running at capture"],
            ["signalState", "String", "GREEN | YELLOW | ALL_RED"],
            ["lanes[]", "Array", "One sub-document per lane (8 per junction)"],
            ["lanes[].laneId", "String", "e.g. N-through"],
            ["lanes[].vehicleCount", "Number", "Vehicles in the detection zone"],
            ["lanes[].queueLength", "Number", "Vehicles standing - the density signal D"],
            ["lanes[].maxWait", "Number", "Longest wait in that lane, seconds"],
            ["lanes[].signal", "String", "red | yellow | green"],
            ["metrics", "Object", "avgWaitTime, totalQueue, throughput, served, idleGreenPct"],
            ["health", "Object", "uptimeSeconds, sensorsOnline, sensorsTotal"],
          ]}
        />
        <P>
          A compound index on{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 text-[12px]">
            {"{ intersectionId: 1, recordedAt: -1 }"}
          </code>{" "}
          supports the dashboard&apos;s dominant query, the most recent N readings for one junction.
        </P>

        <SubTitle>intersections</SubTitle>
        <Table
          head={["Field", "Type", "Description"]}
          rows={[
            ["intersectionId", "String (unique)", "Business key, e.g. INT-001"],
            ["name", "String", "Human-readable junction name"],
            ["location", "Object", "address, latitude, longitude"],
            ["deviceId", "String", "Provisioned controller"],
            ["controlMode", "String", "adaptive | fixed"],
            ["status", "String", "online | degraded | offline"],
            ["lastSeenAt", "Date", "Heartbeat; over 30s stale reads as offline"],
            ["sensorsOnline / sensorsTotal", "Number", "Health of the sensor array"],
          ]}
        />

        <SubTitle>override_commands</SubTitle>
        <Table
          head={["Field", "Type", "Description"]}
          rows={[
            ["intersectionId", "String (indexed)", "Target junction"],
            ["action", "String", "force_phase | release | set_mode | emergency_preempt"],
            ["phase / approach / mode", "String", "Action parameters"],
            ["holdSeconds", "Number", "How long a forced phase is held (5-120)"],
            ["issuedBy", "String", "Operator identity"],
            ["status", "String (indexed)", "pending | acknowledged | expired"],
            ["acknowledgedAt", "Date", "When the controller confirmed it"],
          ]}
        />

        <SubTitle>incidents</SubTitle>
        <Table
          head={["Field", "Type", "Description"]}
          rows={[
            ["intersectionId", "String (indexed)", "Where it happened"],
            ["type", "String", "emergency_preemption | sensor_fault | max_out | manual_override | congestion_alert"],
            ["severity", "String", "info | warning | critical"],
            ["approach", "String", "Affected approach, where relevant"],
            ["message", "String", "Human-readable description"],
            ["responseSeconds", "Number", "Emergency response time"],
            ["occurredAt", "Date (indexed)", "Event timestamp"],
          ]}
        />
      </Section>

      <Section id="usage" title="8. How to use the system">
        <SubTitle>Running it locally</SubTitle>
        <Pre>{`npm install
cp .env.example .env.local     # optional - it runs without this
npm run dev                    # http://localhost:3000`}</Pre>

        <SubTitle>The control room</SubTitle>
        <Bullets
          items={[
            "Run / Pause and the 1x-10x speed selector drive the simulation clock.",
            "Demand scenarios reseed both engines and restart the comparison. Lopsided Demand is the most persuasive to demonstrate.",
            "The sliders retune the controller live: raise Traffic volume until the junction saturates, or widen the gap-out threshold to watch idle green climb.",
            "Force phase and Dispatch emergency queue a command through the cloud; expect a few seconds before the controller picks it up. That delay is the real round trip.",
            "The decision log explains every phase change - which phase was chosen, why, and how many seconds a gap-out recovered.",
          ]}
        />

        <SubTitle>Demonstration script</SubTitle>
        <Bullets
          ordered
          items={[
            "Open the control room and select Lopsided Demand. Let it run for two minutes of simulated time at 5x.",
            "Point at the comparison panel: the adaptive controller is serving roughly 50% more vehicles at a fraction of the waiting time.",
            "Point at the plan view: the fixed baseline would still be giving green to the empty east-west approach. Adaptive is skipping it.",
            "Dispatch an emergency vehicle on N. Watch the running green truncate, the junction clear, and the north-south corridor hold.",
            "Open Analytics to show the same data read back out of the database through the reporting API.",
            "Run npm run benchmark in a terminal for the reproducible headline numbers.",
          ]}
        />

        <SubTitle>Headless controller</SubTitle>
        <P>
          To prove the API works against something other than the browser, run the virtual edge
          controller. It executes the real control loop, uploads telemetry with its device key, and
          polls for operator commands.
        </P>
        <Pre>{`npm run virtual-edge
npm run virtual-edge -- --url https://your-app.vercel.app --id INT-002`}</Pre>
      </Section>

      <Section id="hardware" title="9. What remains: the hardware build">
        <P>
          The project is deliberately structured so that the hardware slots into one clearly marked
          seam. Everything below is what is left to do, and none of it requires changing the
          algorithm, the API, the database or the dashboard.
        </P>

        <SubTitle>9.1 The single integration point</SubTitle>
        <P>
          The simulator implements one method,{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 text-[12px]">
            refreshDetections()
          </code>
          , which produces one{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 text-[12px]">LaneDetection</code>{" "}
          per lane. A hardware build replaces the body of that method with GPIO reads. The controller
          consumes the same structure either way.
        </P>
        <Pre>{`interface LaneDetection {
  laneId: "N-through" | "N-left" | ... ;
  queueLength: number;             // vehicles standing  <- sensor array
  occupancy: number;               // vehicles present   <- sensor array
  stopBarOccupied: boolean;        // stop-bar detector  <- single sensor
  timeSinceLastDetection: number;  // derived on-device
  maxWait: number;                 // derived on-device
  emergencyPresent: boolean;       // siren/strobe or RF beacon
  signal: "red" | "yellow" | "green";
}`}</Pre>

        <SubTitle>9.2 Bill of materials</SubTitle>
        <Table
          head={["Component", "Quantity", "Purpose"]}
          rows={[
            ["Raspberry Pi 4 (2GB+)", "1 per junction", "Edge controller running the control loop"],
            ["HC-SR04 ultrasonic or IR sensor", "8-16", "One or two per lane for queue detection"],
            ["Stop-bar sensor (inductive or IR)", "8", "Gap-out detection at the stop line"],
            ["8-channel relay board (opto-isolated)", "2", "Driving mains LED signal heads"],
            ["LED traffic signal heads", "4 (+4 arrow)", "Physical indication"],
            ["4G/LTE HAT or Wi-Fi", "1", "Uplink to the cloud API"],
            ["Real-time clock module", "1", "Timekeeping across power loss"],
            ["24V PSU with battery backup", "1", "Signals must fail safe, not fail dark"],
            ["Weatherproof IP65 enclosure", "1", "Roadside protection"],
          ]}
        />

        <SubTitle>9.3 Suggested GPIO map</SubTitle>
        <Pre>{`Ultrasonic sensors (BCM numbering)
  N-through  trig 5   echo 6      E-through  trig 23  echo 24
  N-left     trig 12  echo 13     E-left     trig 25  echo 8
  S-through  trig 16  echo 19     W-through  trig 7   echo 1
  S-left     trig 20  echo 26     W-left     trig 0   echo 11

Signal head relays
  N  red 2   amber 3   green 4        E  red 14  amber 15  green 18
  S  red 17  amber 27  green 22       W  red 9   amber 10  green 21

Reserved
  Relay board enable  GPIO 26   (drives all heads to flashing red on fault)`}</Pre>

        <SubTitle>9.4 Remaining work, in order</SubTitle>
        <Bullets
          ordered
          items={[
            "Sensor driver: read each ultrasonic pair, convert distance to presence, debounce, and calibrate the empty-lane baseline per sensor.",
            "Queue estimation: a single sensor gives presence, not queue length. Either place sensors at 10m intervals as the report describes, or infer queue length from how long presence has persisted at the stop bar.",
            "Port the control loop to the Pi: the algorithm in src/lib/sim/controller.ts is pure and dependency-free, so it can be transliterated to Python directly or run on Node on the Pi unchanged.",
            "Relay driver with an interlock that makes conflicting greens physically impossible, not merely unlikely in software.",
            "Fail-safe behaviour: on sensor loss, controller fault or watchdog timeout, fall back to fixed timing; on total failure, flashing red.",
            "Device provisioning: per-device keys or client certificates rather than one shared DEVICE_API_KEY.",
            "Store-and-forward buffering so telemetry survives a connectivity outage and uploads in a batch when the link returns.",
            "Field calibration of saturation headway and startup lost time against the actual junction, since both vary with local driver behaviour.",
            "Pedestrian phases and push-button demand, which the current four-phase plan does not model.",
        ]}
        />

        <Callout tone="warn" title="Safety">
          Nothing in this project is certified for use on a public road. A deployed traffic
          controller requires a hardware conflict monitor that forces flashing red when conflicting
          greens are detected, independently of the software. Software interlocks are necessary but
          never sufficient.
        </Callout>
      </Section>

      <Section id="limitations" title="10. Limitations">
        <Bullets
          items={[
            "Single isolated junction. Green-wave coordination across a corridor is not implemented, though the phase-selection interface would extend to it.",
            "No pedestrian phases or push-button demand; minimum green stands in as a clearance proxy.",
            "Right turns share the through lane rather than having a dedicated movement.",
            "Vehicle arrivals are Poisson, which is realistic for free-flowing traffic but does not capture platoons released by an upstream signal.",
            "No weather, incident or road-works effects on sensor reliability or capacity.",
            "The in-memory fallback store is per-server-instance, so on a multi-instance deployment without MongoDB, different requests may see different data.",
            "Emergency vehicles are detected by a flag on the model rather than by siren or strobe recognition, which is the harder half of the real problem.",
          ]}
        />
      </Section>

      <Section id="stack" title="11. Technology choices">
        <Table
          head={["Layer", "Choice", "Why"]}
          rows={[
            ["Framework", "Next.js 16 (App Router)", "One codebase for UI and API; deploys to Vercel unchanged"],
            ["Language", "TypeScript (strict)", "The control algorithm benefits from exhaustive checking of phase and lane identifiers"],
            ["Database", "MongoDB + Mongoose", "Telemetry is a time series of nested lane documents, which maps naturally to documents"],
            ["Styling", "Tailwind CSS v4", "Control-room palette expressed as design tokens"],
            ["Visualisation", "HTML5 Canvas + hand-built SVG charts", "Canvas for per-frame vehicle rendering; SVG charts avoid a heavy dependency and give exact control over mark specs"],
            ["Hosting", "Vercel", "Serverless routes suit a bursty telemetry workload"],
          ]}
        />
        <P>
          The charts are hand-built rather than taken from a library so that the colour palette
          could be validated for colour-vision deficiency: the two series colours were checked for
          perceptual separation against the dark chart surface rather than chosen by eye.
        </P>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

const SECTIONS = [
  ["overview", "What this system is"],
  ["architecture", "Architecture"],
  ["algorithm", "Control algorithm"],
  ["model", "Traffic model"],
  ["measurement", "Measurement"],
  ["api", "API reference"],
  ["database", "Database schema"],
  ["usage", "How to use it"],
  ["hardware", "Hardware roadmap"],
  ["limitations", "Limitations"],
  ["stack", "Technology choices"],
];

function Nav() {
  return (
    <nav className="card px-4 py-3">
      <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
        Contents
      </p>
      <ol className="grid grid-cols-1 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(([id, label], index) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-accent)]"
            >
              <span className="tnum mr-1.5 text-[var(--color-ink-faint)]">{index + 1}.</span>
              {label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-3 border-b border-[var(--color-line)] pb-2 text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="pt-2 text-[13px] font-semibold tracking-tight text-[var(--color-ink)]">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-4xl text-[12.5px] leading-relaxed text-[var(--color-ink-dim)]">{children}</p>
  );
}

function Em({ children }: { children: React.ReactNode }) {
  return <em className="not-italic font-medium text-[var(--color-ink)]">{children}</em>;
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[#080c15] px-3.5 py-3 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
      <code>{children}</code>
    </pre>
  );
}

function Bullets({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  const List = ordered ? "ol" : "ul";
  return (
    <List className="max-w-4xl space-y-1.5">
      {items.map((item, index) => (
        <li
          key={item}
          className="flex gap-2.5 text-[12.5px] leading-relaxed text-[var(--color-ink-dim)]"
        >
          {ordered ? (
            <span className="tnum shrink-0 text-[var(--color-ink-faint)]">{index + 1}.</span>
          ) : (
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
          )}
          <span>{item}</span>
        </li>
      ))}
    </List>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
      <table className="w-full min-w-[520px] border-collapse text-left text-[11.5px]">
        <thead>
          <tr className="bg-[var(--color-surface-2)]">
            {head.map((h) => (
              <th
                key={h}
                className="px-3 py-2 font-medium text-[var(--color-ink-dim)] first:w-1/4"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join("|")} className="border-t border-[var(--color-line-soft)]">
              {row.map((cell, index) => (
                <td
                  key={index}
                  className={`px-3 py-2 align-top ${
                    index === 0
                      ? "font-medium text-[var(--color-ink)]"
                      : "text-[var(--color-ink-dim)]"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "good" | "warn" | "info";
  title: string;
  children: React.ReactNode;
}) {
  const map = {
    good: "border-emerald-500/25 bg-emerald-500/[0.07]",
    warn: "border-amber-500/25 bg-amber-500/[0.07]",
    info: "border-sky-500/25 bg-sky-500/[0.07]",
  }[tone];
  const titleColor = {
    good: "text-emerald-300",
    warn: "text-amber-300",
    info: "text-sky-300",
  }[tone];

  return (
    <div className={`max-w-4xl rounded-lg border px-3.5 py-3 ${map}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${titleColor}`}>{title}</p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-ink-dim)]">{children}</p>
    </div>
  );
}
