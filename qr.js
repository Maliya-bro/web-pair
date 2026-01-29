import express from "express";
import fs from "fs";
import pino from "pino";
import {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { upload } from "./mega.js";

const router = express.Router();

const clean = (n) => String(n || "").replace(/[^\d]/g, "");

function removeFile(p) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

router.get("/data", async (req, res) => {
  const num = clean(req.query.number);
  if (!num) return res.status(400).json({ code: "Missing number" });

  const dir = "./qr-" + num;
  removeFile(dir);

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
    },
    browser: Browsers.windows("Chrome"),
    printQRInTerminal: false,
    logger: pino({ level: "fatal" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    if (u.qr) {
      const qr = await QRCode.toDataURL(u.qr);
      res.json({ qr });
    }
    if (u.connection === "open") {
      await delay(1500);
      removeFile(dir);
      process.exit(0);
    }
  });
});

export default router;
