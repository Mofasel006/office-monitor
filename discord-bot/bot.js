// bot.js
// This bot has NO device logic of its own. Every command just calls the
// same backend REST API the dashboard's Socket.io feed reads from —
// that's the "single source of truth" requirement satisfied.

require("dotenv").config();
const { Client, GatewayIntentBits, Events } = require("discord.js");
const fetch = require("node-fetch");
const { io } = require("socket.io-client");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID; // channel for proactive pushes
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // optional, enables LLM humanizing

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- optional LLM humanizer. Falls back to a plain template if no key set. ---
async function humanize(rawFacts) {
  if (!ANTHROPIC_API_KEY) return rawFacts.fallbackText;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        system:
          "You're a friendly office assistant bot on Discord. Turn the given raw facts into 1-3 short, warm, conversational sentences. No robotic data dumps, no markdown headers, just talk like a helpful coworker. Stay accurate to the numbers given.",
        messages: [{ role: "user", content: JSON.stringify(rawFacts) }],
      }),
    });
    const data = await res.json();
    const text = data?.content?.find((b) => b.type === "text")?.text;
    return text || rawFacts.fallbackText;
  } catch (err) {
    console.error("LLM humanize failed, falling back to template:", err.message);
    return rawFacts.fallbackText;
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`Discord bot logged in as ${c.user.tag}`);
  subscribeToAlerts();
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.content === "!status") {
    const res = await fetch(`${BACKEND_URL}/api/status`);
    const summary = await res.json();
    const fallback = Object.values(summary.perRoom)
      .map((r) => `${r.label}: ${r.onCount}/${r.devices.length} devices ON (${r.totalWatts}W)`)
      .join(". ");
    const reply = await humanize({
      fallbackText: fallback,
      perRoom: summary.perRoom,
      totalWatts: summary.totalWatts,
    });
    message.reply(reply);
  }

  if (message.content.startsWith("!room ")) {
    const roomArg = message.content.split(" ")[1]?.toLowerCase();
    const res = await fetch(`${BACKEND_URL}/api/rooms/${roomArg}`);
    if (res.status === 404) {
      message.reply(`I don't know a room called "${roomArg}". Try: drawing, work1, work2.`);
      return;
    }
    const room = await res.json();
    const fallback = `${room.label}: ${room.devices
      .map((d) => `${d.label} ${d.status.toUpperCase()}`)
      .join(", ")}. Total: ${room.totalWatts}W.`;
    const reply = await humanize({ fallbackText: fallback, room });
    message.reply(reply);
  }

  if (message.content === "!usage") {
    const res = await fetch(`${BACKEND_URL}/api/usage`);
    const usage = await res.json();
    const fallback = `Total power right now: ${usage.totalWatts}W. Today's estimated usage: ${usage.estimatedKwhToday} kWh.`;
    const reply = await humanize({ fallbackText: fallback, usage });
    message.reply(reply);
  }
});

// --- Bonus: proactively push alerts to a designated channel ---
function subscribeToAlerts() {
  if (!ALERT_CHANNEL_ID) {
    console.log("No ALERT_CHANNEL_ID set — skipping proactive alert push.");
    return;
  }
  const socket = io(BACKEND_URL);
  socket.on("newAlerts", async (alerts) => {
    const channel = await client.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
    if (!channel) return;
    for (const alert of alerts) {
      const emoji = alert.severity === "critical" ? "🚨" : "⚠️";
      channel.send(`${emoji} ${alert.message}`);
    }
  });
}

client.login(DISCORD_TOKEN);
