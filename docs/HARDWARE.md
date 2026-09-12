# Hardware Roadmap

What is simulated, what a physical build requires, and exactly where it plugs in.

> This document exists so the project's boundary is explicit. The software was structured around a
> single integration seam precisely so that the hardware build is an addition rather than a rewrite.

---

## 1. What is simulated and what is not

### Simulated

- IR / ultrasonic sensor hardware and its GPIO wiring
- Physical LED signal heads and their relay drivers
- The Raspberry Pi runtime (the browser or `scripts/virtual-edge.ts` plays this role)
- Camera-based vehicle classification
- Weather effects on sensor reliability

### Real, working software

- The adaptive control algorithm — green-time allocation, gap-out, phase skipping, starvation
  protection, emergency preemption
- The microscopic traffic model — Poisson arrivals, car-following dynamics, saturation discharge
- The REST API, with request validation, device-key authentication and batch ingest
- MongoDB schemas, indexes and the data-access layer
- The operator command queue, including cloud-to-edge delivery and acknowledgement
- The dashboard, audit trail and planning reports

---

## 2. The single integration point

The simulator implements one method — `refreshDetections()` in `src/lib/sim/engine.ts` — which
produces one `LaneDetection` record per lane. **A hardware build replaces the body of that method
with GPIO reads.** Nothing downstream knows the difference.

```ts
interface LaneDetection {
  laneId: "N-through" | "N-left" | "S-through" | ... ;  // 8 lanes
  approach: "N" | "E" | "S" | "W";
  movement: "through" | "left";

  queueLength: number;             // vehicles standing   <- sensor array
  occupancy: number;               // vehicles present    <- sensor array
  stopBarOccupied: boolean;        // stop-bar detector   <- single sensor
  timeSinceLastDetection: number;  // derived on-device
  maxWait: number;                 // derived on-device
  emergencyPresent: boolean;       // siren / strobe / RF beacon
  signal: "red" | "yellow" | "green";
}
```

The control logic in `src/lib/sim/controller.ts` is **pure and dependency-free**: it takes an array
of these records and returns a decision. It imports nothing but its own types and constants, so it
can be transliterated to Python directly, or run unchanged on Node on the Pi.

---

## 3. Bill of materials

Per junction:

| Component | Qty | Purpose | Indicative cost (USD) |
|---|---|---|---|
| Raspberry Pi 4, 2GB or better | 1 | Edge controller | 45–60 |
| microSD card, 32GB, A2 rated | 1 | Boot media | 8 |
| HC-SR04 ultrasonic sensor (or IR equivalent) | 8–16 | Queue detection, 1–2 per lane | 2 each |
| Inductive loop or IR stop-bar detector | 8 | Gap-out detection at the stop line | 15 each |
| 8-channel opto-isolated relay board | 2 | Switching mains LED signal heads | 12 each |
| LED traffic signal head, 3-aspect | 4 | Through indication per approach | 60 each |
| LED arrow head, 3-aspect | 4 | Protected left turn indication | 60 each |
| 4G/LTE HAT (or Wi-Fi, if available) | 1 | Uplink to the cloud API | 45 |
| DS3231 real-time clock module | 1 | Timekeeping across power loss | 5 |
| 24 V PSU with battery backup / UPS | 1 | Signals must fail safe, not fail dark | 90 |
| **Hardware conflict monitor** | 1 | **Safety-critical — see §7** | 120 |
| IP65 weatherproof enclosure | 1 | Roadside protection | 70 |
| Cabling, conduit, connectors, mounts | — | Installation | 100 |

Ultrasonic sensors are the cheap option and are adequate for a proof of concept. They degrade in
heavy rain and with wind-blown debris, which is the limitation the report's §1.5 anticipates. An
inductive loop or a radar unit is the durable choice for a real installation.

---

## 4. Suggested GPIO map

BCM numbering. Sixteen sensor pins and twenty-four relay pins exceed the Pi's usable GPIO count, so
a production build should move the sensor array behind an I²C GPIO expander (MCP23017) or an
Arduino acting as a sensor concentrator over serial.

```
Ultrasonic sensors (trigger / echo)
  N-through  trig  5   echo  6       E-through  trig 23   echo 24
  N-left     trig 12   echo 13       E-left     trig 25   echo  8
  S-through  trig 16   echo 19       W-through  trig  7   echo  1
  S-left     trig 20   echo 26       W-left     trig  0   echo 11

Signal head relays
  N   red  2   amber  3   green  4
  E   red 14   amber 15   green 18
  S   red 17   amber 27   green 22
  W   red  9   amber 10   green 21

Reserved
  GPIO 26   Relay board enable — de-asserting drives all heads to flashing red
  I2C  2/3  Real-time clock, GPIO expander
```

### Sensor placement

The report specifies mounting sensors at 10 m intervals. With one sensor per lane you get
*presence*, not *queue length*. Two workable approaches:

1. **Multiple sensors per lane** at 10 m, 25 m and 50 m from the stop line. Queue length is then
   inferred from which sensors are occupied — the standard "queue detector" arrangement.
2. **Single stop-bar sensor with temporal inference.** Queue length is estimated from how long
   presence has persisted and how many discharge events were counted on the last green. Cheaper,
   less accurate, and it needs calibration against observed counts.

The controller consumes `queueLength` either way, so this choice does not affect the algorithm.

---

## 5. Wiring notes

- **Never drive mains signal heads directly from GPIO.** Use opto-isolated relays with a separate
  supply. A 3.3 V pin connected to a 240 V circuit destroys the Pi and is a fire risk.
- HC-SR04 echo pins output 5 V. The Pi's GPIO is **3.3 V tolerant only** — use a voltage divider
  (1 kΩ / 2 kΩ) or a level shifter on every echo line.
- Give the sensor array its own regulated 5 V rail. Sixteen ultrasonic sensors firing will brown
  out a shared supply and produce phantom readings.
- Trigger sensors in a round-robin, not simultaneously — adjacent units hear each other's pulses
  and report crosstalk as false detections.
- Earth the enclosure and fit surge protection. Roadside cabinets take lightning-induced transients.

---

## 6. Remaining work, in order

1. **Sensor driver.** Read each trigger/echo pair, convert time-of-flight to distance, debounce,
   and calibrate an empty-lane baseline per sensor. Expect to reject outliers aggressively.
2. **Queue estimation.** Convert raw presence into the `queueLength` and `occupancy` figures the
   controller expects, using one of the two approaches in §4.
3. **Port the control loop.** `controller.ts` is pure, so this is a transliteration rather than a
   redesign. Keep the same parameter names so the documentation stays accurate.
4. **Relay driver with a software interlock** that makes conflicting greens impossible to command.
   Necessary but not sufficient — see §7.
5. **Fail-safe behaviour.** On sensor loss, controller fault or watchdog timeout, fall back to
   fixed timing. On total failure, flashing red. The controller must never simply stop with a
   green displayed.
6. **Device provisioning.** Replace the shared `DEVICE_API_KEY` with per-device credentials, ideally
   client certificates with mutual TLS so a compromised unit can be revoked individually.
7. **Store-and-forward buffering** so telemetry survives a connectivity outage and uploads in a
   batch when the link returns. The API already accepts batches of up to 200 documents for exactly
   this reason.
8. **Field calibration** of saturation headway and startup lost time against the actual junction.
   Both vary significantly with local driver behaviour, and the current values (2.0 s and 2.0 s) are
   literature defaults.
9. **Pedestrian phases and push-button demand**, which the current four-phase plan does not model.
10. **Emergency vehicle detection.** The model uses a flag; real detection means siren recognition,
    strobe detection, or an RF/GPS beacon on the vehicle. The beacon approach is by far the most
    reliable and is what most deployed preemption systems (e.g. Opticom-style) use.

---

## 7. Safety

**Nothing in this project is certified for use on a public road.**

A deployed traffic controller requires a **hardware conflict monitor** — an independent circuit that
watches the signal outputs directly and forces the entire junction to flashing red whenever
conflicting greens are detected, whenever the minimum clearance intervals are violated, or whenever
the controller stops sending a heartbeat.

This device is not optional and is not a software component. Software interlocks are necessary but
never sufficient: the whole point of the monitor is that it keeps working when the software is
wrong, hung or compromised. Every real signal controller has one, and it is the reason signal
faults produce flashing red rather than a crash.

Additionally:

- Minimum green, yellow and all-red intervals are legally specified and vary by jurisdiction. The
  values in `constants.ts` are reasonable engineering defaults, not legal ones.
- Yellow interval should be derived from approach speed, not fixed — typically 1 s per 10 mph.
- Any installation on a public road requires approval from the relevant roads authority, and the
  controller hardware itself generally requires type approval.

---

## 8. Estimated effort

| Task | Estimate |
|---|---|
| Sensor driver and calibration | 2–3 weeks |
| Queue estimation and tuning | 1–2 weeks |
| Control loop port and bench testing | 1 week |
| Relay driver and interlocks | 1 week |
| Fail-safe, watchdog, store-and-forward | 1–2 weeks |
| Enclosure, wiring, bench rig assembly | 1–2 weeks |
| Calibration against a real junction | 2 weeks+ |

A bench-top demonstration — four LED heads, eight sensors, one Pi, a model junction on a table — is
achievable in roughly four weeks and is the sensible next milestone. It validates the sensor
driver, the control port and the relay interlocks without any of the regulatory burden of a road
installation.
