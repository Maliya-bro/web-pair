const express = require("express");
const fs = require("fs");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser
} = require("@whiskeysockets/baileys");

const { upload } = require("./mega");
const router = express.Router();

function removeFile(path) {
  if (fs.existsSync(path)) {
    fs.rmSync(path, { recursive: true, force: true });
  }
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).json({ error: "Number required" });

  try {
    const { state, saveCreds } = await useMultiFileAuthState("./session");

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
      },
      logger: pino({ level: "fatal" }),
      browser: Browsers.macOS("Safari"),
      printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);

    if (!sock.authState.creds.registered) {
      await delay(1500);
      num = num.replace(/[^0-9]/g, "");
      const code = await sock.requestPairingCode(num);
      return res.json({ code });
    }

    sock.ev.on("connection.update", async (update) => {
      if (update.connection === "open") {
        await delay(8000);
        const userJid = jidNormalizedUser(sock.user.id);

        const megaUrl = await upload(
          fs.createReadStream("./session/creds.json"),
          `session-${Date.now()}.json`
        );

        await sock.sendMessage(userJid, { text: megaUrl });
        removeFile("./session");
      }
    });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Pairing failed" });
  }
});

module.exports = router;
