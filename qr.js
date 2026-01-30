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
import qrcode from "qrcode";
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

async function waitForFile(filePath, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return true;
    await delay(300);
  }
  return false;
}

/**
 * ✅ Endpoint for UI:
 * GET /qr/data?number=947xxxxxxxx
 * returns: { qr: "data:image/png;base64,...." }
 */
router.get("/data", async (req, res) => {
  let num = String(req.query.number || "").replace(/[^\d]/g, "");
  if (!num) return res.status(400).json({ error: "Missing number" });

  const phone = pn("+" + num);
  if (!phone.isValid()) return res.status(400).json({ error: "Invalid phone number" });

  num = phone.getNumber("e164").replace("+", "");
  const sessionDir = "./" + num;

  // clean old
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

  let sentQr = false;
  let handledOpen = false;

  sock.ev.on("creds.update", async () => {
    try { await saveCreds(); } catch {}
  });

  sock.ev.on("connection.update", async (u) => {
    try {
      // ✅ Send QR to frontend (first time only)
      if (u.qr && !sentQr) {
        sentQr = true;
        const dataUrl = await qrcode.toDataURL(u.qr, { margin: 1, scale: 8 });
        return res.json({ qr: dataUrl });
      }

      // ✅ After scan + link (open)
      if (u.connection === "open" && !handledOpen) {
        handledOpen = true;

        // force save
        try { await saveCreds(); } catch {}

        const credsPath = sessionDir + "/creds.json";

        // wait file exists (deploy fix)
        const ok = await waitForFile(credsPath, 20000);
        if (!ok) {
          console.error("❌ creds.json not found in time:", credsPath);
          try { await sock.end(); } catch {}
          removeFile(sessionDir);
          return;
        }

        // upload
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

        // send to inbox
        try {
          await sock.sendMessage(
            jidNormalizedUser(num + "@s.whatsapp.net"),
            { text: fileId || megaUrl }
          );
        } catch (e) {
          console.error("❌ sendMessage failed:", e?.message || e);
        }

        await delay(1200);
        try { await sock.end(); } catch {}
        removeFile(sessionDir);
      }

      if (u.connection === "close") {
        await delay(300);
        removeFile(sessionDir);
      }
    } catch (e) {
      console.error("❌ connection.update error:", e?.message || e);
    }
  });

  // safety: if QR not produced fast, reply
  setTimeout(() => {
    if (!sentQr) {
      try { res.status(504).json({ error: "QR timeout. Try again." }); } catch {}
      try { sock.end(); } catch {}
      removeFile(sessionDir);
    }
  }, 25000);
});

export default router;
