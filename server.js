import express from "express";
import cors from "cors";
import fs from "fs/promises";

const app = express();
app.use(express.json());

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
app.use(cors({ origin: FRONTEND_ORIGIN }));

const DATA_FILE = "./data.json";

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
  clients.forEach((res) => res.write(payload));
}

app.get("/api/readouts", (req, res) => {
  res.json(data);
});

app.get("/api/readouts/:type", (req, res) => {
  const { type } = req.params;
  const filtered = Object.fromEntries(
    Object.entries(data).filter(([, entry]) => entry.type?.includes(type))
  );
  res.json(filtered);
});

app.post("/api/readouts/:name/adjust", async (req, res) => {
  const { name } = req.params;
  const delta = Number(req.body.delta || 0);

  if (!data[name]) return res.status(404).json({ error: "Unknown readout" });

  const entry = data[name];
  const next = Math.max(entry.lo, Math.min(entry.hi, entry.de + delta));
  entry.de = next;

  await saveData();
  emitUpdate();

  res.json({ name, entry });
});

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify(data)}\n\n`);
  clients.push(res);

  req.on("close", () => {
    clients = clients.filter((c) => c !== res);
  });
});

loadData().then(() => {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Listening on ${port}`));
});
