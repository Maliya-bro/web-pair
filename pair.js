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

function removeFile(path) {
  try {
    if (fs.existsSync(path)) {
      fs.rmSync(path, { recursive: true, force: true });
    }
  } catch {}
}

function getMegaFileId(url) {
  const m = url?.match(/\/file\/([^#]+#[^\/]+)/);
  return m ? m[1] : null;
}

router.get("/", async (req, res) => {
  let num = String(req.query.number || "").replace(/[^\d]/g, "");
  if (!num) return res.status(400).send({ code: "Missing number" });

  const phone = pn("+" + num);
  if (!phone.isValid()) {
    return res.status(400).send({ code: "Invalid phone number" });
  }

  num = phone.getNumber("e164").replace("+", "");
  const sessionDir = "./" + num;

  removeFile(sessionDir);

  async function start() {
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
      browser: Browsers.windows("Chrome"),
      printQRInTerminal: false,
    });

    sock.ev.on("connection.update", async (u) => {
      if (u.connection === "open") {
        try {
          const credsPath = sessionDir + "/creds.json";
          const megaUrl = await upload(
            credsPath,
            `creds_${num}_${Date.now()}.json`
          );

          const fileId = getMegaFileId(megaUrl);
          if (fileId) {
            await sock.sendMessage(
              jidNormalizedUser(num + "@s.whatsapp.net"),
              { text: fileId }
            );
          }

          await delay(1000);
          removeFile(sessionDir);
          process.exit(0);
        } catch {
          process.exit(1);
        }
      }

      if (u.connection === "close") {
        start();
      }
    });

    if (!sock.authState.creds.registered) {
      await delay(3000);
      const code = await sock.requestPairingCode(num);
      res.send({ code: code.match(/.{1,4}/g).join("-") });
    }

    sock.ev.on("creds.update", saveCreds);
  }

  start();
});

export default router;
