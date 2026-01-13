const express = require("express");
const fs = require("fs");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const { upload } = require("./mega");

const router = express.Router();

function removeFile(FilePath) {
  if (fs.existsSync(FilePath)) fs.rmSync(FilePath, { recursive: true, force: true });
}

function getMegaFileId(url) {
  const match = url.match(/\/file\/([^#]+#[^\/]+)/);
  return match ? match[1] : null;
}

router.get("/", async (req, res) => {
  const num = req.query.number?.replace(/\D/g, "");
  if (!num || num.length < 11) return res.status(400).send({ code: "Invalid number" });

  const sessionId = Date.now().toString() + Math.random().toString(36).slice(2, 8);
  const dirs = `./sessions/session_${sessionId}`;

  if (!fs.existsSync("./sessions")) fs.mkdirSync("./sessions", { recursive: true });
  await removeFile(dirs);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(dirs);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
      },
      printQRInTerminal: false,
      logger: pino({ level: "fatal" }).child({ level: "fatal" }),
      browser: Browsers.macOS("Safari"),
    });

    let responseSent = false;

    // Send QR code when generated
    socket.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr && !responseSent) {
        const qrDataURL = await QRCode.toDataURL(qr, { type: "image/png", errorCorrectionLevel: "M" });
        responseSent = true;
        res.send({
          qr: qrDataURL,
          instructions: [
            "1. Open WhatsApp on your phone",
            "2. Go to Settings > Linked Devices",
            "3. Tap 'Link a Device'",
            "4. Scan the QR code above",
          ],
        });
      }

      if (connection === "open") {
        try {
          const credsPath = dirs + "/creds.json";
          const megaUrl = await upload(credsPath, `creds_${sessionId}.json`);
          const megaFileId = getMegaFileId(megaUrl);
          const userJid = jidNormalizedUser(socket.authState.creds.me?.id || "");

          if (userJid && megaFileId) await socket.sendMessage(userJid, { text: megaFileId });
          await delay(1000);
          removeFile(dirs);
          process.exit(0);
        } catch (e) {
          console.error("Upload error:", e);
          removeFile(dirs);
          process.exit(1);
        }
      }

      if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
        console.log("🔁 Connection closed, restarting...");
        removeFile(dirs);
        process.exit(1);
      }
    });

    socket.ev.on("creds.update", saveCreds);

    setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        res.status(408).send({ code: "QR generation timeout" });
        removeFile(dirs);
        process.exit(1);
      }
    }, 30000);

  } catch (err) {
    console.error("Error initializing socket:", err);
    if (!res.headersSent) res.status(503).send({ code: "Service Unavailable" });
    removeFile(dirs);
    setTimeout(() => process.exit(1), 2000);
  }
});

process.on("uncaughtException", (err) => {
  console.log("Caught exception:", err);
  process.exit(1);
});

module.exports = router;
