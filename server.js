import express from "express";
import fs from "fs/promises";

const app = express();
app.use(express.json());

const DATA_FILE = "./data.json";

/* ---------- HARD CORS FIX ---------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

/* ---------- DATA ---------- */
let data = {};
let clients = [];

async function loadData() {
  const raw = await fs.readFile(DATA_FILE, "utf8");
  data = JSON.parse(raw);
}

async function saveData() {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function emitUpdate() {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(payload));
}

/* ---------- ROUTES ---------- */

app.get("/api/readouts", (req, res) => {
  res.json(data);
});

app.get("/api/readouts/:type", (req, res) => {
  const { type } = req.params;

  const filtered = Object.fromEntries(
    Object.entries(data).filter(([, e]) =>
      Array.isArray(e.type) && e.type.includes(type)
    )
  );

  res.json(filtered);
});

/* adjust value */
app.post("/api/readouts/:name/adjust", async (req, res) => {
  const { name } = req.params;
  const delta = Number(req.body.delta || 0);

  if (!data[name]) {
    return res.status(404).json({ error: "Unknown readout" });
  }

  const entry = data[name];
  entry.de = Math.max(entry.lo, Math.min(entry.hi, entry.de + delta));

  await saveData();
  emitUpdate();

  res.json({ name, entry });
});

/* full update */
app.post("/api/readouts/:name", async (req, res) => {
  const { name } = req.params;
  const { lo, hi, de } = req.body;

  if (!data[name]) {
    return res.status(404).json({ error: "Unknown readout" });
  }

  const entry = data[name];

  if (typeof lo === "number") entry.lo = lo;
  if (typeof hi === "number") entry.hi = hi;
  if (typeof de === "number") {
    entry.de = Math.max(entry.lo, Math.min(entry.hi, de));
  }

  await saveData();
  emitUpdate();

  res.json({ name, entry });
});

/* ---------- SSE STREAM (important fix here too) ---------- */
app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  /* ensure CORS ALSO on SSE */
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.flushHeaders();

  res.write(`data: ${JSON.stringify(data)}\n\n`);

  clients.push(res);

  req.on("close", () => {
    clients = clients.filter(c => c !== res);
  });
});

/* ---------- START ---------- */

loadData().then(() => {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Running on ${port}`));
});
