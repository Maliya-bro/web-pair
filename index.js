import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";

import pairRouter from "./pair.js";
import qrRouter from "./qr.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;

import("events").then((events) => {
  events.EventEmitter.defaultMaxListeners = 500;
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ✅ serve static files (pair.html, assets)
app.use(express.static(__dirname));

// ✅ SUPER FAST health for deploy (this is what Replit pings)
app.get("/", (req, res) => {
  res.status(200).type("text/plain").send("OK");
});

// ✅ keep your old health routes too
app.get(["/health", "/_health", "/ping"], (req, res) => {
  res.status(200).type("text/plain").send("OK");
});

// ✅ UI moved to /ui (health check wont load html now)
app.get("/ui", (req, res) => {
  res.sendFile(path.join(__dirname, "pair.html"));
});

// Routers
app.use("/pair", pairRouter);
app.use("/qr", qrRouter);

// ✅ Replit deploy ok with 0.0.0.0
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
});

export default app;
