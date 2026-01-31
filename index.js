import express from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* 🔴 FORCE PORT 5000 */
const PORT = 5000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

/* ✅ FAST health check (deploy safe) */
app.get(["/health", "/_health", "/ping"], (req, res) => {
  res.status(200).send("OK");
});

/* UI */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "pair.html"));
});

/* Lazy-load heavy routers (Baileys) */
app.use("/pair", async (req, res, next) => {
  const mod = await import("./pair.js");
  return mod.default(req, res, next);
});

app.use("/qr", async (req, res, next) => {
  const mod = await import("./qr.js");
  return mod.default(req, res, next);
});

/* 🔴 BIND 0.0.0.0 :5000 */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
});
