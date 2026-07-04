// app.js — connects to the backend's Socket.io feed and re-renders on every "state" event.
// No polling, no manual refresh: the server pushes, this file just paints.

const BACKEND_URL = window.location.origin; // assumes dashboard is served by the same Express app
const socket = io(BACKEND_URL);

const ROOM_ORDER = ["drawing", "work1", "work2"];

socket.on("connect", () => setDot(true));
socket.on("disconnect", () => setDot(false));

socket.on("state", (summary) => {
  renderMeters(summary);
  renderDeviceStatus(summary);
  renderAlerts(summary.alerts);
  renderFloorplan(summary);
});

function setDot(online) {
  const dot = document.getElementById("connectionDot");
  dot.classList.toggle("online", online);
  dot.classList.toggle("offline", !online);
  dot.title = online ? "Live" : "Disconnected";
}

function renderMeters(summary) {
  document.getElementById("totalWatts").textContent = `${summary.totalWatts} W`;
  document.getElementById("kwhToday").textContent = `${summary.estimatedKwhToday} kWh`;
  const onCount = summary.devices.filter((d) => d.status === "on").length;
  document.getElementById("onCount").textContent = `${onCount} / ${summary.devices.length}`;
}

function renderDeviceStatus(summary) {
  const container = document.getElementById("deviceStatus");
  container.innerHTML = "";
  for (const room of ROOM_ORDER) {
    const roomData = summary.perRoom[room];
    const block = document.createElement("div");
    block.className = "room-block";
    block.innerHTML = `<div class="room-title">${roomData.label} — ${roomData.totalWatts}W</div>`;
    for (const d of roomData.devices) {
      const row = document.createElement("div");
      row.className = `device-row ${d.status === "on" ? "on" : ""}`;
      row.innerHTML = `<span class="led ${d.status === "on" ? "on" : ""}"></span>${d.label} (${d.type}) — ${d.status.toUpperCase()}`;
      block.appendChild(row);
    }
    container.appendChild(block);
  }
}

function renderAlerts(alerts) {
  const panel = document.getElementById("alertsPanel");
  if (!alerts || alerts.length === 0) {
    panel.innerHTML = `<p class="empty">No alerts. All quiet.</p>`;
    return;
  }
  panel.innerHTML = alerts
    .map(
      (a) => `
      <div class="alert-item ${a.severity}">
        ${a.message}
        <span class="alert-time">${new Date(a.timestamp).toLocaleTimeString()}</span>
      </div>`
    )
    .join("");
}

// --- Floorplan: simple top-view SVG, 3 rooms side by side, devices glow/spin live ---
function renderFloorplan(summary) {
  const container = document.getElementById("floorplan");
  const roomWidth = 220;
  const roomHeight = 200;
  const gap = 10;
  const totalWidth = roomWidth * 3 + gap * 2;

  let svg = `<svg viewBox="0 0 ${totalWidth} ${roomHeight + 20}" xmlns="http://www.w3.org/2000/svg">`;

  ROOM_ORDER.forEach((room, idx) => {
    const x = idx * (roomWidth + gap);
    const roomData = summary.perRoom[room];
    svg += `<rect class="room-box" x="${x}" y="10" width="${roomWidth}" height="${roomHeight}" rx="6"/>`;
    svg += `<text class="room-label" x="${x + 10}" y="26">${roomData.label}</text>`;

    const lights = roomData.devices.filter((d) => d.type === "light");
    const fans = roomData.devices.filter((d) => d.type === "fan");

    // 3 lights along the top of the room
    lights.forEach((light, i) => {
      const cx = x + 40 + i * 65;
      const cy = 55;
      svg += `<g class="light-icon ${light.status === "on" ? "on" : ""}">
        <circle cx="${cx}" cy="${cy}" r="10"/>
      </g>`;
    });

    // 2 fans in the lower half of the room
    fans.forEach((fan, i) => {
      const cx = x + 70 + i * 90;
      const cy = 140;
      svg += `<g class="fan-icon ${fan.status === "on" ? "on" : ""}" style="transform-origin:${cx}px ${cy}px">
        <line x1="${cx - 18}" y1="${cy}" x2="${cx + 18}" y2="${cy}" stroke-width="3"/>
        <line x1="${cx}" y1="${cy - 18}" x2="${cx}" y2="${cy + 18}" stroke-width="3"/>
      </g>`;
    });
  });

  svg += `</svg>`;
  container.innerHTML = svg;
}
