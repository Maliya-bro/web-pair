import express from "express";
import fs from "fs";
import pino from "pino";
import qrcode from "qrcode";
import {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import { upload } from "./mega.js";

const router = express.Router();

/**
 * ✅ one socket per number
 */
const ACTIVE = new Map(); // num -> { sock, dir, timer, responded }

function rm(p) {
  try { fs.existsSync(p) && fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

async function waitFile(filePath, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return true;
    await delay(300);
  }
  return false;
}

async function cleanup(num, reason = "") {
  const cur = ACTIVE.get(num);
  if (!cur) return;

  ACTIVE.delete(num);
  try { clearTimeout(cur.timer); } catch {}
  try { await cur.sock?.end?.(); } catch {}

  await delay(2500);
  rm(cur.dir);

  if (reason) console.log("🧹 cleaned", num, reason);
}

/**
 * GET /qr/data?number=947xxxxxxxx
 * returns { qr: "data:image/png;base64,..." }
 */
router.get("/data", async (req, res) => {
  let num = String(req.query.number || "").replace(/\D/g, "");

  if (num.length < 10 || num.length > 15) {
    return res.status(400).json({ error: "Invalid number" });
  }

  const dir = "./session_" + num;

  if (ACTIVE.has(num)) await cleanup(num, "restart");
  rm(dir);

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
    },
    logger: pino({ level: "fatal" }),
    browser: Browsers.windows("Chrome"),
    printQRInTerminal: false,
    keepAliveIntervalMs: 20000,
    connectTimeoutMs: 60000
  });

  sock.ev.on("creds.update", async () => {
    try { await saveCreds(); } catch {}
  });

  // ✅ timeout 90s
  const timer = setTimeout(() => {
    // if QR not returned in time
    try { res.status(504).json({ error: "QR timeout. Try again." }); } catch {}
    cleanup(num, "timeout-90s");
  }, 90000);

  ACTIVE.set(num, { sock, dir, timer, responded: false });

  let handled = false;

  sock.ev.on("connection.update", async (u) => {
    try {
      if (u.connection) console.log("🔌", num, "connection:", u.connection);

      // ✅ send QR once
      const cur = ACTIVE.get(num);
      if (u.qr && cur && !cur.responded) {
        cur.responded = true;
        const img = await qrcode.toDataURL(u.qr, { margin: 1, scale: 8 });
        return res.json({ qr: img });
      }

      // ✅ finalize open + registered
      if (!handled && u.connection === "open" && sock.authState?.creds?.registered) {
        handled = true;
        console.log("✅", num, "linked by QR (open + registered)");

        // wait WhatsApp finalize
        await delay(30000);

        try { await saveCreds(); } catch {}
        const credsPath = dir + "/creds.json";

        const ok = await waitFile(credsPath, 30000);
        if (ok) {
          try {
            const url = await upload(credsPath, `creds_${num}_${Date.now()}.json`);
            await sock.sendMessage(jidNormalizedUser(num + "@s.whatsapp.net"), { text: url });
            console.log("📨 inbox sent");
          } catch (e) {
            console.log("❌ upload/send error:", e?.message || e);
          }
        } else {
          console.log("❌ creds.json missing");
        }

        await cleanup(num, "done");
        return;
      }

      if (u.connection === "close") {
        console.log("⚠️ close ignored (waiting until timeout/open)");
      }
    } catch (e) {
      console.log("❌ connection.update error:", e?.message || e);
    }
  });
});

export default router;
