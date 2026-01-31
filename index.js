import express from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Replit deployments use env PORT
const PORT = process.env.PORT || 5000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ✅ health check
app.get(["/health", "/_health", "/ping"], (req, res) => {
  res.status(200).type("text/plain").send("OK");
});

// UI
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "pair.html"));
});

// Pair route (lazy import)
app.use("/pair", async (req, res, next) => {
  try {
    const mod = await import("./pair.js");
    return mod.default(req, res, next);
  } catch (e) {
    console.error("❌ pair router load error:", e?.message || e);
    return res.status(503).send("Service Unavailable");
  }
});

// QR route (lazy import)
app.use("/qr", async (req, res, next) => {
  try {
    const mod = await import("./qr.js");
    return mod.default(req, res, next);
  } catch (e) {
    console.error("❌ qr router load error:", e?.message || e);
    return res.status(503).send("Service Unavailable");
  }
});

// ✅ bind
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
});

export default app;
