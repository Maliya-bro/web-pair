import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";

import pairRouter from "./pair.js";
import qrRouter from "./qr.js";
import { getSessionId, setSessionId } from "./session-store.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// direct config
const PORT = 5000;

import("events").then((events) => {
  events.EventEmitter.defaultMaxListeners = 500;
});

app.get(["/health", "/_health", "/ping"], (req, res) => {
  res.status(200).send("OK");
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    res.sendFile(path.join(__dirname, "pair.html"));
  } catch (err) {
    console.error("UI load error:", err);
    res.status(500).send("Error loading UI");
  }
});

app.get("/session-id", (req, res) => {
  res.json({ sessionId: getSessionId() });
});

app.post("/session-id/clear", (req, res) => {
  setSessionId("");
  res.json({ ok: true });
});

app.use("/pair", pairRouter);
app.use("/qr", qrRouter);

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
