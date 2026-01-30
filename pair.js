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

function removeFile(p) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

function getMegaFileId(url) {
  const m = url?.match(/\/file\/([^#]+#[^\/]+)/);
  return m ? m[1] : null;
}

async function waitForFile(filePath, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return true;
    await delay(300);
  }
  return false;
}

router.get("/", async (req, res) => {
  let num = String(req.query.number || "").replace(/[^\d]/g, "");
  if (!num) return res.status(400).json({ code: "Missing number" });

  const phone = pn("+" + num);
  if (!phone.isValid()) return res.status(400).json({ code: "Invalid phone number" });

  num = phone.getNumber("e164").replace("+", "");
  const sessionDir = "./" + num;

  // clean old session
  removeFile(sessionDir);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
    },
    logger: pino({ level: "fatal" }),
    browser: Browsers.windows("Chrome"),
    printQRInTerminal: false,
  });

  // IMPORTANT: avoid infinite loops
  let handledOpen = false;

  sock.ev.on("creds.update", async () => {
    try { await saveCreds(); } catch {}
  });

  sock.ev.on("connection.update", async (u) => {
    try {
      if (u.connection === "open" && !handledOpen) {
        handledOpen = true;

        // ✅ force save creds now
        try { await saveCreds(); } catch {}

        const credsPath = sessionDir + "/creds.json";

        // ✅ wait until file exists (deploy වල fast timing fix)
        const ok = await waitForFile(credsPath, 20000);
        if (!ok) {
          console.error("❌ creds.json not found in time:", credsPath);
          try { await sock.end(); } catch {}
          removeFile(sessionDir);
          return;
        }

        // ✅ upload to mega
        let megaUrl;
        try {
          megaUrl = await upload(credsPath, `creds_${num}_${Date.now()}.json`);
        } catch (e) {
          console.error("❌ MEGA upload failed:", e?.message || e);
          try { await sock.end(); } catch {}
          removeFile(sessionDir);
          return;
        }

        const fileId = getMegaFileId(megaUrl);

        // ✅ send to same whatsapp number inbox
        try {
          if (fileId) {
            await sock.sendMessage(
              jidNormalizedUser(num + "@s.whatsapp.net"),
              { text: fileId }
            );
          } else {
            // fallback: send full URL if fileId parse fail
            await sock.sendMessage(
              jidNormalizedUser(num + "@s.whatsapp.net"),
              { text: megaUrl }
            );
          }
        } catch (e) {
          console.error("❌ sendMessage failed:", e?.message || e);
        }

        // ✅ cleanup without killing server
        await delay(1200);
        try { await sock.end(); } catch {}
        removeFile(sessionDir);
      }

      if (u.connection === "close") {
        // just cleanup; do NOT restart endlessly inside deployment
        await delay(300);
        removeFile(sessionDir);
      }
    } catch (e) {
      console.error("❌ connection.update error:", e?.message || e);
    }
  });

  // send pairing code response
  if (!sock.authState.creds.registered) {
    await delay(1200);
    const code = await sock.requestPairingCode(num);
    return res.json({ code: code.match(/.{1,4}/g).join("-") });
  }

  return res.json({ code: "Already registered" });
});

export default router;
