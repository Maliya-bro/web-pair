import express from "express";
import fs from "fs";
import pino from "pino";
import { exec } from "child_process";
import {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pn from "awesome-phonenumber";
import { upload } from "./mega.js";

const router = express.Router();
const logger = pino({ level: "fatal" });

/* ================= UTIL ================= */

function removeFile(dir) {
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function getMegaFileId(url) {
  const m = url?.match(/\/file\/([^#]+#[^\/]+)/);
  return m ? m[1] : null;
}

/* ================= ROUTE ================= */

router.get("/", async (req, res) => {
  let num = (req.query.number || "").replace(/[^0-9]/g, "");
  if (!num) return res.status(400).send({ code: "Phone number required" });

  const phone = pn("+" + num);
  if (!phone.isValid()) {
    return res.status(400).send({ code: "Invalid phone number" });
  }

  num = phone.getNumber("e164").replace("+", "");
  const sessionDir = `./session_${num}`;

  removeFile(sessionDir);

  async function startPair() {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      browser: Browsers.windows("Chrome"),
      markOnlineOnConnect: false,
    });

    let pairingSent = false;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      const { connection, isNewLogin, lastDisconnect } = u;

      /* ===== PAIRING CODE ===== */
      if (
        !sock.authState.creds.registered &&
        !pairingSent &&
        (connection === "open" || isNewLogin)
      ) {
        pairingSent = true;
        try {
          await delay(2500); // ⚠️ IMPORTANT
          let code = await sock.requestPairingCode(num);
          code = code?.match(/.{1,4}/g)?.join("-") || code;

          if (!res.headersSent) res.send({ code });
        } catch (e) {
          if (!res.headersSent) {
            res.status(503).send({ code: "Pair code error" });
          }
          exec("pm2 restart maliya-md");
        }
      }

      /* ===== CONNECTED ===== */
      if (connection === "open") {
        try {
          await delay(2000);

          const credsPath = `${sessionDir}/creds.json`;
          const megaUrl = await upload(
            credsPath,
            `creds_${num}_${Date.now()}.json`
          );

          const fileId = getMegaFileId(megaUrl);
          if (fileId) {
            const jid = jidNormalizedUser(num + "@s.whatsapp.net");
            await sock.sendMessage(jid, { text: fileId });
          }

          await delay(1500);
          removeFile(sessionDir);
          process.exit(0);
        } catch (e) {
          removeFile(sessionDir);
          exec("pm2 restart maliya-md");
          process.exit(1);
        }
      }

      /* ===== CLOSED ===== */
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log("Connection closed:", code);

        if (code !== 401) {
          await delay(3000);
          startPair();
        }
      }
    });
  }

  startPair();
});

/* ================= SAFETY ================= */

process.on("uncaughtException", (err) => {
  const e = String(err);
  if (
    e.includes("conflict") ||
    e.includes("not-authorized") ||
    e.includes("rate-overlimit") ||
    e.includes("Connection Closed")
  )
    return;

  console.log("Uncaught:", err);
  exec("pm2 restart maliya-md");
  process.exit(1);
});

export default router;
