# Setup Guide

Everything needed to run the Smart Traffic Management System locally and deploy it to Vercel.

> **The short version:** `npm install && npm run dev`. The application runs completely without a
> database or any configuration — it falls back to an in-memory store. Read on only when you want
> persistence, authentication, or a public deployment.

---

## 1. Prerequisites

| Requirement | Version | Check with |
|---|---|---|
| Node.js | 20.0 or later (22.x recommended) | `node --version` |
| npm | 10 or later | `npm --version` |
| Git | any recent | `git --version` |
| MongoDB Atlas account | free tier is enough | *optional* |

Node.js is available from <https://nodejs.org>. Choose the LTS build.

---

## 2. Install and run

```bash
# 1. Get the code into place, then from the project folder:
npm install

# 2. Start the development server
npm run dev
```

Open <http://localhost:3000>.

You should see the overview page. Click **Open the control room** and the simulation starts
immediately. A yellow "Demo mode" banner confirms it is running without a database — that is
expected and everything works.

### Verify the install

```bash
npm run typecheck      # should print nothing
npm run build          # should end with a route table
npm run benchmark      # should print the comparison table
```

---

## 3. Environment variables

Copy the template:

```bash
cp .env.example .env.local          # macOS / Linux
copy .env.example .env.local        # Windows CMD
Copy-Item .env.example .env.local   # Windows PowerShell
```

`.env.local` is git-ignored. **Every variable is optional.**

| Variable | Default | What it does |
|---|---|---|
| `MONGODB_URI` | *(empty)* | MongoDB connection string. Empty ⇒ in-memory store. |
| `MONGODB_DB` | `smart_traffic` | Database name inside the cluster. |
| `DEVICE_API_KEY` | *(empty)* | Shared secret edge controllers send as `x-device-key`. Empty ⇒ telemetry ingest is open. |
| `OPERATOR_PASSCODE` | `traffic2026` | Passcode required before an operator can change a signal. Empty ⇒ no passcode gate. |
| `NEXT_PUBLIC_TELEMETRY_INTERVAL_MS` | `5000` | How often (real milliseconds) the in-browser controller uploads telemetry. |
| `NEXT_PUBLIC_COMMAND_POLL_MS` | `4000` | How often (real milliseconds) it polls for operator commands. |
| `NEXT_PUBLIC_DEFAULT_INTERSECTION` | `INT-001` | Junction the dashboard loads first. |
| `NEXT_PUBLIC_SHOW_DEMO_BANNER` | `true` | Set `false` to hide the demo banner during a live presentation. |

Generate a strong device key with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Restart the dev server after editing `.env.local` — Next.js reads it at startup.

---

## 4. MongoDB Atlas (optional, for persistence)

### 4.1 Create a free cluster

1. Sign up at <https://www.mongodb.com/cloud/atlas>.
2. **Build a Database** → choose the free **M0** tier → pick a region near you → **Create**.

### 4.2 Create a database user

1. **Database Access** → **Add New Database User**.
2. Authentication method: **Password**. Choose a username and a generated password.
3. Role: **Read and write to any database**. → **Add User**.
4. **Copy the password now** — Atlas will not show it again.

### 4.3 Allow network access

1. **Network Access** → **Add IP Address**.
2. For development, **Allow Access from Anywhere** (`0.0.0.0/0`) is acceptable.
3. For a Vercel deployment this is **required**, because Vercel's serverless functions do not have
   fixed outbound IP addresses on the free plan.

### 4.4 Get the connection string

1. **Database** → **Connect** → **Drivers** → **Node.js**.
2. Copy the string. It looks like:

```
mongodb+srv://myuser:<password>@cluster0.ab12cde.mongodb.net/?retryWrites=true&w=majority
```

3. Replace `<password>` with the real password and put it in `.env.local`:

```bash
MONGODB_URI=mongodb+srv://myuser:YourRealPassword@cluster0.ab12cde.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=smart_traffic
```

> **Percent-encode special characters in the password.** If it contains `@ : / ? # [ ] %` the URI
> will not parse. `p@ss:word` must become `p%40ss%3Aword`. The simplest fix is to generate a
> password with letters and digits only.

### 4.5 Confirm it connected

Restart the dev server and visit <http://localhost:3000/api/health>:

```json
{ "storage": { "backend": "mongodb", "persistent": true } }
```

The demo-mode banner on the dashboard disappears, and the badge in the status strip reads
**MongoDB**.

### 4.6 Seed reference data (optional)

```bash
npm run seed
```

This upserts the three reference intersections and generates three hours of realistic historical
telemetry by running the real engine, so `/analytics` has something to report on immediately.

---

## 5. Running the headless edge controller

To demonstrate that the API works independently of the browser — which is the point of the
hardware seam — run the virtual edge controller in a second terminal while the dev server is up:

```bash
npm run virtual-edge
```

It runs the real adaptive control loop, uploads telemetry every 5 seconds with its device key, and
polls for operator commands. Its output looks like:

```
[00:40] uploaded #2 | phase EW_THROUGH  YELLOW | queue  18 | avg wait 0.0s | served 7
[01:19] uploaded #3 | phase NS_THROUGH  YELLOW | queue  13 | avg wait 14.7s | served 26
```

Against a deployed instance:

```bash
npm run virtual-edge -- --url https://your-app.vercel.app --id INT-002
```

If `DEVICE_API_KEY` is set on the server, it must also be set in your local `.env.local` or the
uploads will be rejected with a clear `401` message.

---

## 6. Deploying to Vercel

### 6.1 Push to GitHub

```bash
git init
git add .
git commit -m "Smart Traffic Management System"
git branch -M main
git remote add origin https://github.com/<you>/smart-traffic-system.git
git push -u origin main
```

### 6.2 Import into Vercel

1. Sign in at <https://vercel.com> with GitHub.
2. **Add New → Project** → import the repository.
3. Vercel detects Next.js automatically. **Do not change the build settings.**

### 6.3 Add environment variables

Before the first deploy, open **Environment Variables** and add whichever you need:

| Name | Value | Environments |
|---|---|---|
| `MONGODB_URI` | your Atlas string | Production, Preview, Development |
| `MONGODB_DB` | `smart_traffic` | all |
| `DEVICE_API_KEY` | your generated key | all |
| `OPERATOR_PASSCODE` | your chosen passcode | all |

Then **Deploy**. The build takes about a minute.

> If you skip all of them it still deploys and works, in demo mode. Note that with serverless
> functions the in-memory store is per-instance and short-lived, so telemetry may appear to reset
> between requests. Configure `MONGODB_URI` for a deployment anyone else will look at.

### 6.4 After deploying

- Visit `https://your-app.vercel.app/api/health` and confirm `"backend": "mongodb"`.
- Open `/dashboard` and let it run for a minute.
- Open `/analytics` and confirm the samples are being read back.

---

## 7. Troubleshooting

**`MongooseServerSelectionError` / connection timeout**
The cluster is not reachable. Check **Network Access** in Atlas includes `0.0.0.0/0`, and that the
username and password in the URI are correct. The app degrades to the in-memory store rather than
crashing, so look at `/api/health` to see which backend is actually in use.

**`Invalid scheme, expected connection string to start with "mongodb://"`**
`MONGODB_URI` is malformed — usually a stray quote or a line break. It must be one line.

**Password with special characters fails**
Percent-encode it, or regenerate an alphanumeric password. See §4.4.

**`401` on telemetry upload from `virtual-edge`**
`DEVICE_API_KEY` differs between the server and your `.env.local`. Make them match, or clear it on
both sides for an open demo.

**Operator commands rejected with "Operator authentication required"**
Type the value of `OPERATOR_PASSCODE` into the *Warden passcode* field in the control panel before
issuing a command.

**Commands take a few seconds to take effect**
That is intentional. Commands are queued in the database and collected by the controller on its
next poll, which is the real cloud-to-edge round trip. Adjust `NEXT_PUBLIC_COMMAND_POLL_MS` if you
want it snappier for a demo.

**Dashboard is slow or the animation stutters**
Lower the speed multiplier from 10× to 2×, or reduce traffic volume. The model integrates at a
fixed 0.1 s timestep, so a higher multiplier means proportionally more work per frame.

**`JavaScript heap out of memory` during `npm run build`**
Raise the limit for one run:
```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

**Port 3000 already in use**
```bash
npm run dev -- -p 3001
```

---

## 8. A suggested demonstration sequence

1. Open the control room. Select **Lopsided Demand**. Set speed to **5×**.
2. Let it run for two minutes of simulated time.
3. Show the comparison panel — the adaptive controller is serving roughly 50% more vehicles at a
   fraction of the waiting time, on an identical arrival stream.
4. Show the plan view — the fixed baseline would still be holding green for the empty east–west
   approach; the adaptive controller is skipping it.
5. Show the decision log — every phase change with the reason it was chosen, and how many seconds
   each gap-out recovered.
6. **Dispatch emergency** on N. Watch the green truncate, the junction clear, and the corridor hold.
7. Open **Analytics** — the same data, read back out of the database through the reporting API.
8. In a terminal, run `npm run benchmark` for the reproducible headline figures.
