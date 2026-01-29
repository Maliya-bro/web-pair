import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";

// Replit deploy health-check fix:
// heavy routers (Baileys) lazy-load wenne route hit unama

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

// event listener limit
import("events").then((events) => {
  events.EventEmitter.defaultMaxListeners = 500;
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ✅ FAST health check (Replit deploy eka mekata hit karanawa)
app.get(["/health", "/_health", "/ping"], (req, res) => {
  res.status(200).type("text/plain").send("ok");
});

// main UI
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "pair.html"));
});

// ✅ Lazy load pair router
app.use("/pair", async (req, res, next) => {
  try {
    const mod = await import("./pair.js");
    return mod.default(req, res, next);
  } catch (e) {
    console.error("PAIR ROUTER LOAD ERROR:", e);
    return res.status(503).send("Service Unavailable");
  }
});

// ✅ Lazy load qr router
app.use("/qr", async (req, res, next) => {
  try {
    const mod = await import("./qr.js");
    return mod.default(req, res, next);
  } catch (e) {
    console.error("QR ROUTER LOAD ERROR:", e);
    return res.status(503).send("Service Unavailable");
  }
});

// ✅ IMPORTANT: bind 0.0.0.0 for Replit
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
});

export default app;
