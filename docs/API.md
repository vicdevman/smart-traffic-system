# API Reference

Base URL: `http://localhost:3000` in development, or your Vercel URL in production.
All request and response bodies are JSON. All responses carry an `ok` boolean.

---

## Authentication

| Credential | Header | Guards | Skipped when |
|---|---|---|---|
| Device key | `x-device-key: <DEVICE_API_KEY>` | Telemetry ingest, command collection, incident reporting | `DEVICE_API_KEY` is unset |
| Operator passcode | `x-operator-passcode: <OPERATOR_PASSCODE>` | Issuing any command that can change a signal | `OPERATOR_PASSCODE` is unset |

Both are skipped when the corresponding environment variable is empty, which keeps the project
runnable out of the box. Section 7 below covers what must replace this before a field deployment.

---

## `GET /api/health`

Liveness and configuration probe. Used by the dashboard to decide whether to show the demo banner,
and suitable for an uptime monitor.

```json
{
  "ok": true,
  "service": "smart-traffic-management-system",
  "version": "1.0.0",
  "timestamp": "2026-09-11T00:23:09.670Z",
  "storage": {
    "backend": "memory",
    "persistent": false,
    "note": "No MONGODB_URI configured - running on the in-memory store. Data is lost on restart."
  },
  "security": { "deviceKeyEnforced": false, "operatorPasscodeEnforced": false }
}
```

---

## `GET /api/intersections`

Fleet listing. `status` is derived from the heartbeat: a junction that has not reported in 30
seconds reads as `offline` regardless of its stored status.

```json
{
  "ok": true,
  "backend": "memory",
  "count": 3,
  "intersections": [
    {
      "intersectionId": "INT-001",
      "name": "Ahmadu Bello Way / Herbert Macaulay Junction",
      "location": { "address": "Central Business District", "latitude": 6.4531, "longitude": 3.3958 },
      "deviceId": "RPI-EDGE-001",
      "approaches": ["N", "E", "S", "W"],
      "controlMode": "adaptive",
      "status": "online",
      "lastSeenAt": "2026-09-11T00:23:41.488Z",
      "sensorsTotal": 8,
      "sensorsOnline": 8,
      "secondsSinceLastReport": 11
    }
  ]
}
```

---

## `GET /api/intersections/:id`

One junction, its most recent telemetry sample, its last 60 readings and its last 20 incidents.

**Returns `404`** when the junction is unknown.

```json
{
  "ok": true,
  "intersection": { "intersectionId": "INT-001", "...": "..." },
  "latest": { "recordedAt": "...", "metrics": { "...": "..." } },
  "history": [],
  "incidents": []
}
```

---

## `POST /api/telemetry`

**Auth:** device key.

Ingest endpoint for edge controllers. Accepts a single document, a bare array, or
`{ "batch": [ ... ] }`. Maximum 200 documents per request.

### Request

```http
POST /api/telemetry
Content-Type: application/json
x-device-key: 3f9a...c21
```

```json
{
  "intersectionId": "INT-001",
  "deviceId": "RPI-EDGE-001",
  "recordedAt": "2026-09-11T00:23:41.488Z",
  "simTime": 120.4,
  "mode": "adaptive",
  "currentPhase": "NS_THROUGH",
  "signalState": "GREEN",
  "lanes": [
    {
      "laneId": "N-through",
      "approach": "N",
      "movement": "through",
      "vehicleCount": 7,
      "queueLength": 5,
      "maxWait": 18.3,
      "signal": "green"
    }
  ],
  "metrics": {
    "avgWaitTime": 19.4,
    "totalQueue": 9,
    "throughputPerHour": 2148,
    "vehiclesServed": 54,
    "idleGreenPct": 3.3
  },
  "health": { "uptimeSeconds": 120, "sensorsOnline": 8, "sensorsTotal": 8 }
}
```

Only `intersectionId` is strictly required. Every other field is coerced to a sane type or
defaulted, so a partially-implemented controller can still report something useful.

### Response

```json
{ "ok": true, "accepted": 1, "rejected": 0, "serverTime": "2026-09-11T00:23:41.502Z" }
```

### Errors

| Status | Meaning |
|---|---|
| `400` | Malformed JSON, or no documents supplied |
| `401` | Missing or wrong `x-device-key` |
| `413` | Batch larger than 200 documents |
| `422` | No document in the batch was valid; `problems[]` explains why |

Accepting a telemetry POST also refreshes the junction's heartbeat and sets its status to `online`,
or `degraded` when `sensorsOnline < sensorsTotal`.

---

## `GET /api/telemetry`

Time series for charts. Returned **oldest first** so it can be plotted without reversing.

| Query | Default | Range |
|---|---|---|
| `intersectionId` | `INT-001` | — |
| `limit` | `120` | 1–1000 |

```json
{ "ok": true, "intersectionId": "INT-001", "count": 120, "logs": [] }
```

---

## `POST /api/overrides`

**Auth:** operator passcode.

Queues an operator command. The command is **not applied immediately** — it is stored with status
`pending`, collected by the controller on its next poll, applied, and then acknowledged.

### Request

```json
{
  "intersectionId": "INT-001",
  "action": "force_phase",
  "phase": "EW_LEFT",
  "holdSeconds": 25,
  "issuedBy": "warden-07"
}
```

| Field | Required | Notes |
|---|---|---|
| `intersectionId` | yes | — |
| `action` | yes | `force_phase` · `release` · `set_mode` · `emergency_preempt` |
| `phase` | for `force_phase` | `NS_THROUGH` · `NS_LEFT` · `EW_THROUGH` · `EW_LEFT` |
| `approach` | for `emergency_preempt` | `N` · `E` · `S` · `W` |
| `mode` | for `set_mode` | `adaptive` · `fixed` |
| `holdSeconds` | no | Clamped to 5–120, default 20 |
| `issuedBy` | no | Truncated to 64 characters, default `operator` |

### Response `201`

```json
{
  "ok": true,
  "command": {
    "id": "ovr-1",
    "intersectionId": "INT-001",
    "action": "force_phase",
    "phase": "EW_LEFT",
    "holdSeconds": 25,
    "issuedBy": "warden-07",
    "status": "pending",
    "createdAt": "2026-09-11T00:24:00.344Z",
    "acknowledgedAt": null
  }
}
```

Every command is also written to the incident log as an audit record.

### Errors

| Status | Meaning |
|---|---|
| `400` | Missing `intersectionId`, unknown `action`, or an invalid `phase` / `approach` for the action |
| `401` | Missing or wrong `x-operator-passcode` |

---

## `GET /api/overrides`

**Auth:** device key.

Collected by the edge controller. Returns up to 20 pending commands, oldest first.

```json
{
  "ok": true,
  "intersectionId": "INT-001",
  "count": 1,
  "commands": [{ "id": "ovr-1", "action": "force_phase", "phase": "EW_LEFT", "holdSeconds": 25 }],
  "operatorAuthEnforced": false
}
```

## `PATCH /api/overrides`

**Auth:** device key.

The controller confirms it has applied the listed commands, closing the loop so they are not
delivered twice. Maximum 50 ids.

```json
{ "ids": ["ovr-1", "ovr-2"] }
```

```json
{ "ok": true, "acknowledged": 2 }
```

---

## `GET /api/incidents`

Audit trail, newest first.

| Query | Default | Range |
|---|---|---|
| `intersectionId` | all junctions | — |
| `limit` | `50` | 1–200 |

```json
{
  "ok": true,
  "count": 1,
  "incidents": [
    {
      "id": "inc-2",
      "intersectionId": "INT-001",
      "type": "manual_override",
      "severity": "warning",
      "approach": "",
      "message": "Operator warden-07 forced phase EW_LEFT for 25s",
      "responseSeconds": 0,
      "occurredAt": "2026-09-11T00:24:00.349Z"
    }
  ]
}
```

## `POST /api/incidents`

**Auth:** device key. Raised by a controller when it preempts, maxes out a phase, or loses a sensor.

```json
{
  "intersectionId": "INT-001",
  "type": "emergency_preemption",
  "severity": "critical",
  "approach": "N",
  "message": "Ambulance given priority on the north approach",
  "responseSeconds": 16.8
}
```

`type` must be one of `emergency_preemption`, `sensor_fault`, `max_out`, `manual_override`,
`congestion_alert`. `severity` is one of `info`, `warning`, `critical` (default `info`).
`message` is truncated to 300 characters.

---

## `GET /api/reports/summary`

Planning report. Aggregates stored telemetry into the outputs a city planning department asks for.

| Query | Default | Range |
|---|---|---|
| `intersectionId` | `INT-001` | — |
| `limit` | `500` | 10–1000 |

```json
{
  "ok": true,
  "intersectionId": "INT-001",
  "samples": 240,
  "window": { "from": "2026-09-11T00:20:00.000Z", "to": "2026-09-11T00:40:00.000Z" },
  "headline": {
    "avgWaitTime": 8.53,
    "avgQueue": 10.5,
    "avgThroughputPerHour": 843,
    "avgIdleGreenPct": 7,
    "vehiclesServed": 52
  },
  "peak": { "totalQueue": 18, "occurredAt": "...", "phaseAtPeak": "EW_THROUGH" },
  "busiestHour": { "hour": 8, "avgQueue": 14.2, "samples": 60 },
  "approachLoad": [{ "approach": "S", "avgQueue": 2.13, "peakWait": 60.9 }],
  "hourlyProfile": [{ "hour": 8, "avgQueue": 14.2, "samples": 60 }],
  "emergency": { "preemptions": 3, "avgResponseSeconds": 16.8 },
  "incidentsByType": { "manual_override": 2, "emergency_preemption": 3 },
  "recommendations": [
    "Idle green time is 7%, within the 15% target for a demand-responsive plan.",
    "The S approach carries 4.3x the queue of the W approach. This junction is a candidate for a dedicated lane or a coordinated green wave along that corridor."
  ]
}
```

When no telemetry exists yet, `samples` is `0` and `message` explains how to generate some.

---

## Simulator bridge routes

`POST /api/edge/telemetry`, `GET /api/edge/commands`, `PATCH /api/edge/commands`

These exist **only** for the in-browser simulator, which cannot hold the device secret. They
enforce a same-origin check, perform identical validation, and write to the identical store. They
**cannot create commands** — that still requires the operator passcode on `/api/overrides`.

Real hardware uses the device-authenticated routes and never touches these. See
[ARCHITECTURE.md §7](ARCHITECTURE.md) for the reasoning.

---

## Before a field deployment

The credential model here is deliberately minimal so the project runs out of the box. A real
deployment needs:

- **Per-device credentials**, not one shared `DEVICE_API_KEY` — ideally client certificates with
  mutual TLS, so a compromised device can be revoked individually.
- **A real operator identity system** with named accounts, roles and session management, rather
  than a single shared passcode.
- **Rate limiting** on ingest, so a faulty or hostile device cannot flood the collection.
- **Signed commands**, so a controller can verify an instruction genuinely came from the control
  centre before it changes what a signal head displays.
- **Replay protection** — a nonce or timestamp window on telemetry and commands alike.
