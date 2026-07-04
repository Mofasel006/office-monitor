# Office Power Monitor — Lights, Fans, Discord

A live dashboard + Discord bot that monitor 18 simulated devices (2 fans + 3 lights across Drawing Room, Work Room 1, Work Room 2). One backend, two clients, one source of truth.

## Architecture

```
[Simulated Device Layer] → [Backend: Express + Socket.io] → [Web Dashboard]  → [User]
                                                            → [Discord Bot]  → [User]
```

Full diagram: `diagrams/system-diagram.svg`

The simulator ticks every 5 seconds, flips 0-2 devices, recomputes total wattage, and runs two alert checks (after-hours, continuous-2h+). The backend pushes the new state over Socket.io to the dashboard and exposes REST endpoints the Discord bot polls on demand. Same array, same numbers, both places.

## Repo layout

```
backend/         Express + Socket.io server, device simulator, alert engine
dashboard/       Static HTML/CSS/JS client (served by the backend, or open directly)
discord-bot/     discord.js bot, calls backend REST API
diagrams/        System architecture diagram (SVG, hand-drawn, no Mermaid)
```

## Setup

### 1. Backend

```bash
cd backend
npm install
npm start
```

Runs on `http://localhost:4000`. This also serves the dashboard at `http://localhost:4000` directly (static files), so for the simplest demo you don't need a separate frontend server.

REST endpoints (used by the bot, but you can curl them too):

- `GET /api/status` — full summary: all devices, per-room totals, alerts
- `GET /api/rooms/:room` — `drawing` | `work1` | `work2`
- `GET /api/usage` — total watts + estimated kWh today
- `GET /api/alerts` — last 20 alerts

### 2. Dashboard

If you served it from the backend (step 1), just open `http://localhost:4000` in a browser. No build step, no npm install needed for the dashboard itself — it's vanilla JS + the Socket.io CDN client.

### 3. Discord bot

```bash
cd discord-bot
npm install
cp .env.example .env
# fill in DISCORD_TOKEN, ALERT_CHANNEL_ID, and (optional) ANTHROPIC_API_KEY
npm start
```

Commands:

| Command | What it does |
|---|---|
| `!status` | Full office summary, humanized |
| `!room <drawing\|work1\|work2>` | Status of one room |
| `!usage` | Current watts + today's estimated kWh |

If `ANTHROPIC_API_KEY` is set, replies are rewritten conversationally by Claude before posting. If it's not set, the bot falls back to a plain-but-accurate template — never a hardcoded or random response either way, since both paths pull real numbers from `/api/status`.

Bonus feature: if `ALERT_CHANNEL_ID` is set, the bot opens a Socket.io connection to the backend alongside its REST calls and proactively posts to that channel the moment a new alert fires (after-hours device left on, or a room fully lit for 2+ hours straight).

## Hardware / Circuit (Wokwi) — Work Room 1 as the representative room

No physical hardware was built — this is a concept schematic showing how the simulated states above would map to a real board. Build it in Wokwi with an ESP32:

| Device | Wokwi component | ESP32 pin | Signal |
|---|---|---|---|
| Light 1 | LED | GPIO 4 | Digital OUT, HIGH = on |
| Light 2 | LED | GPIO 5 | Digital OUT, HIGH = on |
| Light 3 | LED | GPIO 18 | Digital OUT, HIGH = on |
| Fan 1 | Relay module → DC motor | GPIO 19 | Digital OUT drives relay coil |
| Fan 2 | Relay module → DC motor | GPIO 21 | Digital OUT drives relay coil |
| Current sensor (optional) | ACS712 | GPIO 34 (ADC1_CH6) | Analog IN, estimates real wattage |

**Electrical reasoning:** the ESP32 never switches mains current directly — GPIOs 19/21 only energize a relay's low-voltage coil, and the relay's high-voltage side does the actual fan switching. LEDs stand in for the lights and can be driven directly off GPIO through a current-limiting resistor since their draw is trivial. The ACS712 sits in series with the room's live feed and reports a proportional analog voltage on an ADC-capable pin, which the firmware would convert to an estimated wattage instead of hardcoding 60W/15W — useful in a real deployment where fans don't always draw exactly rated wattage.

Only one room is wired as a representative circuit per the brief; the same pin pattern repeats for Drawing Room and Work Room 2 in a full build.

## Assumptions & trade-offs

- **In-memory state, not a database.** For a hackathon demo, restart-persistence isn't worth the added complexity. If this needed to survive backend restarts, the next step would be a small SQLite file or Redis — noted here rather than built, since it's out of scope for round 1.
- **Simulator flips 0-2 devices per 5s tick**, weighted toward "no change," so the demo looks like a real office rather than random flicker.
- **Alert de-duplication window of 60s** prevents the same after-hours warning from spamming every tick.
- **LLM humanizing is optional** (falls back cleanly) so the bot still works in a live demo even without network access to the Anthropic API.

## Validation

- Manually verified `/api/status` totals match the sum of individual device wattages (2×60W fans + 3×15W lights per room = 165W per room fully on, 495W office-wide max).
- Confirmed alert logic fires correctly by manually setting system alerts after 5PM and forcing a room's devices to `on` for testing.
- Dashboard tested with backend killed mid-session — connection dot correctly flips to offline, no crash on reconnect.
