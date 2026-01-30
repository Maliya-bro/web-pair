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

async function waitForFile(filePath, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return true;
    await delay(300);
  }
  return false;
}

async function waitUntilRegistered(sock, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (sock?.authState?.creds?.registered) return true;
    await delay(500);
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

  // ✅ clean old
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

  sock.ev.on("creds.update", async () => {
    try { await saveCreds(); } catch {}
  });

  // ✅ Pair code generate
  if (!sock.authState.creds.registered) {
    await delay(1200);
    const codeRaw = await sock.requestPairingCode(num);
    const code = codeRaw.match(/.{1,4}/g).join("-");

    // ✅ IMPORTANT: respond immediately (UI shows code)
    res.json({ code });

    // ✅ Now WAIT until user finishes pairing (fix for "Logging in" stuck)
    const okReg = await waitUntilRegistered(sock, 70000);
    if (!okReg) {
      console.error("❌ Pairing timeout (still not registered)");
      try { await sock.end(); } catch {}
      removeFile(sessionDir);
      return;
    }

    // ✅ make sure creds saved + file exists
    try { await saveCreds(); } catch {}
    const credsPath = sessionDir + "/creds.json";
    const okFile = await waitForFile(credsPath, 20000);
    if (!okFile) {
      console.error("❌ creds.json not found in time");
      try { await sock.end(); } catch {}
      removeFile(sessionDir);
      return;
    }

    // ✅ upload + send to inbox
    try {
      const megaUrl = await upload(credsPath, `creds_${num}_${Date.now()}.json`);
      const fileId = getMegaFileId(megaUrl);

      try {
        await sock.sendMessage(
          jidNormalizedUser(num + "@s.whatsapp.net"),
          { text: fileId || megaUrl }
        );
      } catch (e) {
        console.error("❌ sendMessage failed:", e?.message || e);
      }
    } catch (e) {
      console.error("❌ MEGA upload failed:", e?.message || e);
    }

    // ✅ cleanup (after everything)
    await delay(1500);
    try { await sock.end(); } catch {}
    removeFile(sessionDir);
    return;
  }

  return res.json({ code: "Already registered" });
});

export default router;
