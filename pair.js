import express from "express";
import fs from "fs";
import pino from "pino";
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

/* ================= UTILITIES ================= */

function removeFile(dir) {
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.error("Remove error:", e);
  }
}

function getMegaFileId(url) {
  try {
    const match = url.match(/\/file\/([^#]+#[^\/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/* ================= ROUTE ================= */

router.get("/", async (req, res) => {
  let num = (req.query.number || "").toString().replace(/[^0-9]/g, "");
  if (!num) {
    return res.status(400).send({ code: "Phone number required" });
  }

  const phone = pn("+" + num);
  const valid =
    typeof phone.isValidNumber === "function"
      ? phone.isValidNumber()
      : phone.isValid();

  if (!valid) {
    return res.status(400).send({
      code: "Invalid phone number. Use full international format.",
    });
  }

  // normalize to e164 digits only
  num = phone.getNumber("e164").replace("+", "");
  const sessionDir = "./session_" + num;

  removeFile(sessionDir);

  async function startPair() {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          pino({ level: "fatal" })
        ),
      },
      logger: pino({ level: "fatal" }),
      printQRInTerminal: false,
      browser: Browsers.windows("Chrome"),
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });

    let pairingRequested = false;

    sock.ev.on("connection.update", async (update) => {
      const { connection, isNewLogin, lastDisconnect } = update;

      /* ======= PAIR CODE (CORRECT TIMING) ======= */
      if (
        !sock.authState.creds.registered &&
        !pairingRequested &&
        (connection === "open" || isNewLogin)
      ) {
        pairingRequested = true;
        try {
          // ⚠️ CRITICAL DELAY
          await delay(2500);

          let code = await sock.requestPairingCode(num);
          code = code?.match(/.{1,4}/g)?.join("-") || code;

          if (!res.headersSent) {
            console.log("PAIR CODE:", code);
            res.send({ code });
          }
        } catch (err) {
          console.error("PAIR ERROR:", err?.output?.payload || err);
          if (!res.headersSent) {
            res.status(503).send({
              code: "Error generating code. Please try again.",
            });
          }
        }
      }

      /* ======= AFTER LOGIN ======= */
      if (connection === "open") {
        try {
          console.log("✅ Connected. Uploading session…");

          const credsPath = sessionDir + "/creds.json";
          const megaUrl = await upload(
            credsPath,
            `creds_${num}_${Date.now()}.json`
          );

          const fileId = getMegaFileId(megaUrl);
          if (fileId) {
            const userJid = jidNormalizedUser(num + "@s.whatsapp.net");
            await sock.sendMessage(userJid, { text: fileId });
          }

          await delay(1500);
          removeFile(sessionDir);
          await delay(1500);
          process.exit(0);
        } catch (e) {
          console.error("UPLOAD ERROR:", e);
          removeFile(sessionDir);
          process.exit(1);
        }
      }

      /* ======= CLOSE ======= */
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log("Connection closed:", code);
      }
    });

    sock.ev.on("creds.update", saveCreds);
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
    e.includes("Connection Closed") ||
    e.includes("Timed Out")
  )
    return;
  console.log("Uncaught:", err);
  process.exit(1);
});

export default router;
