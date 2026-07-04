// server.js
// Single backend. Web dashboard connects via Socket.io for live push updates.
// Discord bot hits the REST endpoints below. Same deviceStore, same reality.

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");
const store = require("./deviceStore");

const PORT = process.env.PORT || 4000;
const TICK_MS = 5000; // simulator + alert check cadence

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "dashboard")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ---- REST API (this is what the Discord bot calls) ----

app.get("/api/status", (req, res) => {
  res.json(store.getSummary());
});

app.get("/api/rooms/:room", (req, res) => {
  const room = req.params.room;
  if (!store.ROOMS.includes(room)) {
    return res.status(404).json({ error: `Unknown room "${room}". Valid: ${store.ROOMS.join(", ")}` });
  }
  const devices = store.getDevicesByRoom(room);
  res.json({
    room,
    label: store.ROOM_LABELS[room],
    totalWatts: store.currentRoomWatts(room),
    devices,
  });
});

app.get("/api/usage", (req, res) => {
  const summary = store.getSummary();
  res.json({
    totalWatts: summary.totalWatts,
    estimatedKwhToday: summary.estimatedKwhToday,
    timestamp: summary.timestamp,
  });
});

app.get("/api/alerts", (req, res) => {
  res.json(store.getSummary().alerts);
});

// ---- Socket.io live feed for the dashboard ----

io.on("connection", (socket) => {
  socket.emit("state", store.getSummary());
});

let previousAlertCount = 0;

function broadcast() {
  const summary = store.getSummary();
  io.emit("state", summary);

  // Bonus hook: if new alerts appeared this tick, emit a dedicated event
  // the Discord bot process can also subscribe to (see discord-bot/bot.js)
  if (summary.alerts.length > previousAlertCount) {
    const newest = summary.alerts.slice(0, summary.alerts.length - previousAlertCount);
    io.emit("newAlerts", newest);
  }
  previousAlertCount = summary.alerts.length;
}

setInterval(() => {
  store.tickSimulator();
  broadcast();
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`Office monitor backend running on http://localhost:${PORT}`);
});
