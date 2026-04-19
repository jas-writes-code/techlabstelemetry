import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.disable("x-powered-by");
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "data.json");

const DEFAULT_DATA = {
  temp: { lo: 0, hi: 500, de: 100, type: ["core", "env", "pwr"] }
};

let data = {};
let clients = [];

function sendCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

app.use((req, res, next) => {
  sendCors(res);
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

async function loadData() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    data = parsed && typeof parsed === "object" ? parsed : structuredClone(DEFAULT_DATA);
  } catch {
    data = structuredClone(DEFAULT_DATA);
    await saveData();
  }
}

async function saveData() {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function emitUpdate() {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

app.get("/", (req, res) => {
  res.type("json").send({ ok: true, service: "readouts-api" });
});

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/readouts", (req, res) => {
  res.json(data);
});

app.get("/api/readouts/:type", (req, res) => {
  const { type } = req.params;
  const filtered = Object.fromEntries(
    Object.entries(data).filter(([, entry]) => Array.isArray(entry.type) && entry.type.includes(type))
  );
  res.json(filtered);
});

app.post("/api/readouts/:name/adjust", async (req, res) => {
  const { name } = req.params;
  const delta = Number(req.body?.delta ?? 0);

  const entry = data[name];
  if (!entry) {
    return res.status(404).json({ error: "Unknown readout" });
  }

  entry.de = clamp(Number(entry.de) + delta, Number(entry.lo), Number(entry.hi));

  await saveData();
  emitUpdate();

  res.json({ name, entry });
});

app.post("/api/readouts/:name", async (req, res) => {
  const { name } = req.params;
  const entry = data[name];

  if (!entry) {
    return res.status(404).json({ error: "Unknown readout" });
  }

  const body = req.body ?? {};

  if (typeof body.lo === "number" && Number.isFinite(body.lo)) entry.lo = body.lo;
  if (typeof body.hi === "number" && Number.isFinite(body.hi)) entry.hi = body.hi;

  if (typeof body.de === "number" && Number.isFinite(body.de)) {
    entry.de = clamp(body.de, entry.lo, entry.hi);
  } else {
    entry.de = clamp(Number(entry.de), Number(entry.lo), Number(entry.hi));
  }

  await saveData();
  emitUpdate();

  res.json({ name, entry });
});

app.get("/api/stream", (req, res) => {
  sendCors(res);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify(data)}\n\n`);
  clients.push(res);

  req.on("close", () => {
    clients = clients.filter((client) => client !== res);
  });
});

const port = Number(process.env.PORT || 10000);

loadData()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Readouts API listening on ${port}`);
    });
  })
  .catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
