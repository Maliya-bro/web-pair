import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";

import pairRouter from "./pair.js";
import qrRouter from "./qr.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import("events").then((events) => {
  events.EventEmitter.defaultMaxListeners = 500;
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get(["/health", "/_health", "/ping"], (req, res) => {
  res.status(200).type("text/plain").send("OK");
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "pair.html"));
});

app.use("/pair", pairRouter);
app.use("/qr", qrRouter);

// ❌ remove app.listen
export default app;

