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
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import { upload } from "./mega.js";

const router = express.Router();

/**
 * ✅ one socket per number
 */
const ACTIVE = new Map(); // num -> { sock, dir, timer }

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

  // ✅ don’t delete instantly
  await delay(2500);
  rm(cur.dir);

  if (reason) console.log("🧹 cleaned", num, reason);
}

router.get("/", async (req, res) => {
  let num = String(req.query.number || "").replace(/\D/g, "");

  // ✅ simple validation
  if (num.length < 10 || num.length > 15) {
    return res.status(400).json({ code: "Invalid number" });
  }

  const dir = "./session_" + num;

  // close old
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
    keepAliveIntervalMs: 20000,
    connectTimeoutMs: 60000
  });

  sock.ev.on("creds.update", async () => {
    try { await saveCreds(); } catch {}
  });

  // ✅ timeout 90s (NOT 30s)
  const timer = setTimeout(() => cleanup(num, "timeout-90s"), 90000);
  ACTIVE.set(num, { sock, dir, timer });

  let handled = false;

  sock.ev.on("connection.update", async (u) => {
    try {
      if (u.connection) console.log("🔌", num, "connection:", u.connection);

      // ✅ finalize only when open + registered
      if (!handled && u.connection === "open" && sock.authState?.creds?.registered) {
        handled = true;
        console.log("✅", num, "linked (open + registered)");

        // ✅ wait WhatsApp finalize (fix logging in)
        await delay(30000);

        try { await saveCreds(); } catch {}
        const credsPath = dir + "/creds.json";

        const ok = await waitFile(credsPath, 30000);
        if (!ok) {
          console.log("❌ creds.json missing");
          await cleanup(num, "no-creds");
          return;
        }

        try {
          const url = await upload(credsPath, `creds_${num}_${Date.now()}.json`);
          await sock.sendMessage(jidNormalizedUser(num + "@s.whatsapp.net"), { text: url });
          console.log("📨 inbox sent");
        } catch (e) {
          console.log("❌ upload/send error:", e?.message || e);
        }

        await cleanup(num, "done");
        return;
      }

      // ❌ ignore close early (don’t cleanup)
      if (u.connection === "close") {
        console.log("⚠️ close ignored (waiting until timeout/open)");
      }
    } catch (e) {
      console.log("❌ connection.update error:", e?.message || e);
    }
  });

  // ✅ generate pairing code
  try {
    await delay(1200);
    const raw = await sock.requestPairingCode(num);
    const code = raw.match(/.{1,4}/g).join("-");
    return res.json({ code });
  } catch (e) {
    await cleanup(num, "pairing-code-failed");
    return res.status(500).json({ code: "Pairing code failed" });
  }
});

export default router;
