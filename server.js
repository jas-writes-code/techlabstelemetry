import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "data.json");

let data = {};
let clients = [];
let active = new Set();

/* ---------- CORS ---------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ---------- helpers ---------- */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

async function loadData() {
  try {
    data = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch {
    data = {};
  }
}

async function saveData() {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function emit() {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(c => c.write(payload));
}

/* ---------- gradual change ---------- */
function animateValue(name, target) {
  const entry = data[name];
  if (!entry) return;

  active.add(name);

  const duration = 1000 + Math.random() * 4000;
  const steps = Math.floor(duration / 100);
  const start = entry.de;
  const diff = target - start;

  let i = 0;
  const interval = setInterval(() => {
    i++;
    entry.de = clamp(start + (diff * i / steps), entry.lo, entry.hi);
    emit();

    if (i >= steps) {
      clearInterval(interval);
      entry.de = clamp(target, entry.lo, entry.hi);
      active.delete(name);
      emit();
      saveData();
    }
  }, 100);
}

/* ---------- idle fluctuation ---------- */
setInterval(() => {
  for (const [name, e] of Object.entries(data)) {
    if (active.has(name)) continue;

    const delta = (Math.random() * 10) - 5;
    e.de = clamp(e.de + delta, e.lo, e.hi);
  }
  emit();
}, 1500);

/* ---------- routes ---------- */

app.get("/api/readouts", (req, res) => res.json(data));

app.get("/api/readouts/:type", (req, res) => {
  const t = req.params.type;
  res.json(Object.fromEntries(
    Object.entries(data).filter(([,e]) => e.type?.includes(t))
  ));
});

app.post("/api/readouts/:name/adjust", (req, res) => {
  const { name } = req.params;
  const delta = Number(req.body.delta || 0);
  if (!data[name]) return res.sendStatus(404);

  const target = clamp(data[name].de + delta, data[name].lo, data[name].hi);
  animateValue(name, target);

  res.json({ ok: true });
});

app.post("/api/readouts/:name", (req, res) => {
  const { name } = req.params;
  if (!data[name]) return res.sendStatus(404);

  const { lo, hi, de } = req.body;
  if (typeof lo === "number") data[name].lo = lo;
  if (typeof hi === "number") data[name].hi = hi;

  if (typeof de === "number") {
    animateValue(name, clamp(de, data[name].lo, data[name].hi));
  }

  saveData();
  res.json({ ok: true });
});

/* ---------- SSE ---------- */
app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.write(`data: ${JSON.stringify(data)}\n\n`);
  clients.push(res);

  req.on("close", () => {
    clients = clients.filter(c => c !== res);
  });
});

/* ---------- start ---------- */
loadData().then(() => {
  app.listen(process.env.PORT || 10000);
});
