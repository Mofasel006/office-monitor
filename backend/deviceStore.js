// deviceStore.js
// This is the "one source of truth" the whole architecture hinges on.
// Both the Socket.io dashboard feed and the Discord bot's REST calls
// read from this exact in-memory array. Nothing else holds state.

const ROOMS = ["drawing", "work1", "work2"];
const ROOM_LABELS = {
  drawing: "Drawing Room",
  work1: "Work Room 1",
  work2: "Work Room 2",
};

const WATTAGE = { fan: 60, light: 15 };

function buildInitialDevices() {
  const devices = [];
  const now = new Date().toISOString();

  for (const room of ROOMS) {
    for (let i = 1; i <= 2; i++) {
      devices.push({
        id: `${room}-fan-${i}`,
        type: "fan",
        label: `Fan ${i}`,
        room,
        status: "off",
        wattage: WATTAGE.fan,
        lastChanged: now,
      });
    }
    for (let i = 1; i <= 3; i++) {
      devices.push({
        id: `${room}-light-${i}`,
        type: "light",
        label: `Light ${i}`,
        room,
        status: "off",
        wattage: WATTAGE.light,
        lastChanged: now,
      });
    }
  }
  return devices;
}

let devices = buildInitialDevices();
let alerts = []; // { id, message, room, severity, timestamp }
let dailyEnergyWh = 0; // accumulated watt-hours since simulator start (today's estimate)
let lastTickAt = Date.now();

function getDevices() {
  return devices;
}

function getDevicesByRoom(room) {
  return devices.filter((d) => d.room === room);
}

function currentTotalWatts() {
  return devices.reduce((sum, d) => (d.status === "on" ? sum + d.wattage : sum), 0);
}

function currentRoomWatts(room) {
  return getDevicesByRoom(room).reduce(
    (sum, d) => (d.status === "on" ? sum + d.wattage : sum),
    0
  );
}

function getSummary() {
  const perRoom = {};
  for (const room of ROOMS) {
    const roomDevices = getDevicesByRoom(room);
    perRoom[room] = {
      label: ROOM_LABELS[room],
      totalWatts: currentRoomWatts(room),
      devices: roomDevices,
      onCount: roomDevices.filter((d) => d.status === "on").length,
    };
  }
  return {
    totalWatts: currentTotalWatts(),
    estimatedKwhToday: +(dailyEnergyWh / 1000).toFixed(2),
    perRoom,
    devices,
    alerts: alerts.slice(-20).reverse(),
    timestamp: new Date().toISOString(),
  };
}

// --- Simulator: flips a small, believable number of devices each tick ---
function tickSimulator() {
  const now = Date.now();
  const elapsedHours = (now - lastTickAt) / 1000 / 3600;
  lastTickAt = now;

  // accumulate energy based on watts drawn since last tick
  dailyEnergyWh += currentTotalWatts() * elapsedHours;

  // Flip 0-2 random devices per tick, weighted toward "no change" so it
  // doesn't look like random noise every few seconds.
  const flipCount = Math.random() < 0.6 ? 1 : Math.random() < 0.9 ? 2 : 0;
  for (let i = 0; i < flipCount; i++) {
    const device = devices[Math.floor(Math.random() * devices.length)];
    device.status = device.status === "on" ? "off" : "on";
    device.lastChanged = new Date().toISOString();
  }

  runAlertChecks();
}

function runAlertChecks() {
  const now = new Date();
  const hour = now.getHours();
  const isOfficeHours = hour >= 9 && hour < 17;
  const newAlerts = [];

  if (!isOfficeHours) {
    for (const d of devices) {
      if (d.status === "on") {
        newAlerts.push({
          id: `${d.id}-afterhours-${now.getTime()}`,
          message: `${ROOM_LABELS[d.room]}: ${d.label} is still ON outside office hours (9AM-5PM).`,
          room: d.room,
          severity: "warning",
          timestamp: now.toISOString(),
        });
      }
    }
  }

  for (const room of ROOMS) {
    const roomDevices = getDevicesByRoom(room);
    const allOn = roomDevices.every((d) => d.status === "on");
    if (allOn) {
      const oldestChange = Math.max(
        ...roomDevices.map((d) => new Date(d.lastChanged).getTime())
      );
      const hoursOn = (now.getTime() - oldestChange) / 1000 / 3600;
      if (hoursOn >= 2) {
        newAlerts.push({
          id: `${room}-continuous-${now.getTime()}`,
          message: `${ROOM_LABELS[room]}: every device has been ON continuously for over 2 hours. Did someone forget to leave?`,
          room,
          severity: "critical",
          timestamp: now.toISOString(),
        });
      }
    }
  }

  // De-dupe: don't spam identical alerts within the same minute
  for (const a of newAlerts) {
    const recentDup = alerts.find(
      (existing) =>
        existing.message === a.message &&
        now.getTime() - new Date(existing.timestamp).getTime() < 60000
    );
    if (!recentDup) alerts.push(a);
  }

  // keep alert log bounded
  if (alerts.length > 200) alerts = alerts.slice(-200);

  return newAlerts;
}

module.exports = {
  ROOMS,
  ROOM_LABELS,
  getDevices,
  getDevicesByRoom,
  currentTotalWatts,
  currentRoomWatts,
  getSummary,
  tickSimulator,
  runAlertChecks,
};
