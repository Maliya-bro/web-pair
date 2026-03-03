import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";

import pairRouter from "./pair.js";
import qrRouter from "./qr.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Deploy-safe PORT (fallback 5000)
const PORT = process.env.PORT || 5000;

// ✅ Increase event listeners limit (avoid warnings/crash)
import("events").then((events) => {
  events.EventEmitter.defaultMaxListeners = 500;
});

// ✅ Health check endpoints (at the top)
app.get(["/health", "/_health", "/ping"], (req, res) => {
  res.status(200).send("OK");
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// UI
app.get("/", (req, res) => {
  try {
    res.sendFile(path.join(__dirname, "pair.html"));
  } catch (err) {
    res.status(500).send("Error loading UI");
  }
});

// Routers
app.use("/pair", pairRouter);
app.use("/qr", qrRouter);

// ✅ Bind 0.0.0.0 :5000
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
});

export default app;
