import express from "express";
import fs from "fs";
import pino from "pino";
import path from "path";
import {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { upload } from "./mega.js";

const router = express.Router();

function cleanNumber(n) {
  return String(n || "").replace(/[^\d]/g, "");
}

function removeFile(FilePath) {
  try {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
  } catch (e) {
    console.error("Error removing file:", e);
  }
}

function getMegaFileId(url) {
  try {
    const match = url.match(/\/file\/([^#]+#[^\/]+)/);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

/**
 * ✅ 1) QR Page (HTML)
 * UI එක window.open("/qr?number=...") කරන නිසා මෙතන HTML එකක් යවන්න.
 */
router.get("/", async (req, res) => {
  const num = cleanNumber(req.query.number);
  if (!num) return res.status(400).send("❌ Missing number. Example: /qr?number=94701234567");

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MALIYA-MD • QR</title>
  <style>
    :root{color-scheme:dark}
    body{font-family:system-ui;background:#0b0f18;color:#fff;min-height:100vh;margin:0;display:grid;place-items:center;padding:18px}
    .card{max-width:560px;width:100%;padding:22px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14)}
    h2{margin:0 0 6px}
    p{margin:0;opacity:.78}
    .qr{margin-top:14px;display:grid;place-items:center}
    img{border-radius:14px;background:#fff;padding:10px;max-width:320px;width:100%}
    .small{margin-top:10px;font-size:13px;opacity:.65;line-height:1.4}
    .err{margin-top:10px;font-size:13px;color:#ffb3b3;white-space:pre-wrap}
    .btn{margin-top:14px;display:inline-block;padding:10px 14px;border-radius:14px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);color:#fff;text-decoration:none}
  </style>
</head>
<body>
  <div class="card">
    <h2>📷 Scan QR to Link</h2>
    <p>Number: ${num}</p>

    <div class="qr">
      <img id="qrImg" alt="QR" />
    </div>

    <div class="small" id="msg">⏳ Generating QR...</div>
    <div class="err" id="err"></div>

    <a class="btn" href="/qr?number=${encodeURIComponent(num)}">↻ Refresh</a>
  </div>

<script>
(async ()=>{
  const img = document.getElementById("qrImg");
  const msg = document.getElementById("msg");
  const err = document.getElementById("err");

  try{
    const r = await fetch("/qr/data?number=${encodeURIComponent(num)}", { cache: "no-store" });
    const data = await r.json();

    if(!r.ok){
      err.textContent = data?.code || "QR error";
      msg.textContent = "❌ Failed";
      return;
    }
    if(data?.qr){
      img.src = data.qr;
      msg.textContent = "✅ Open WhatsApp > Linked Devices > Link a device > Scan";
      err.textContent = "";
    }else{
      msg.textContent = "❌ QR not found";
      err.textContent = JSON.stringify(data, null, 2);
    }
  }catch(e){
    msg.textContent = "❌ Error";
    err.textContent = String(e);
  }
})();
</script>
</body>
</html>`);
});

/**
 * ✅ 2) QR Data endpoint (JSON)
 * QR code dataURL එක මෙතනින් එනවා.
 */
router.get("/data", async (req, res) => {
  const num = cleanNumber(req.query.number);
  if (!num) return res.status(400).json({ code: "Missing number" });

  if (!fs.existsSync("./qr_sessions")) fs.mkdirSync("./qr_sessions", { recursive: true });

  // ✅ stable session folder per number (avoid creating unlimited folders)
  const dirs = `./qr_sessions/session_${num}`;

  // If you want a fresh QR each time, uncomment:
  // await removeFile(dirs);

  const { state, saveCreds } = await useMultiFileAuthState(dirs);

  let responseSent = false;

  try {
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
      },
      printQRInTerminal: false,
      logger: pino({ level: "fatal" }).child({ level: "fatal" }),
      browser: Browsers.windows("Chrome"),
      markOnlineOnConnect: false,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 250,
      maxRetries: 5,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // ✅ send QR JSON only once
      if (qr && !responseSent) {
        responseSent = true;

        const qrDataURL = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: "M",
          type: "image/png",
          quality: 0.92,
          margin: 1,
          color: { dark: "#000000", light: "#FFFFFF" },
        });

        return res.json({
          qr: qrDataURL,
          message: "QR generated",
        });
      }

      if (connection === "open") {
        // ✅ connected: upload session (no process.exit)
        try {
          const credsPath = dirs + "/creds.json";
          const megaUrl = await upload(credsPath, `creds_qr_${num}.json`);
          const megaFileId = getMegaFileId(megaUrl);

          if (megaFileId) {
            const userJid = jidNormalizedUser(sock.authState.creds.me?.id || "");
            if (userJid) {
              await sock.sendMessage(userJid, { text: `${megaFileId}` });
            }
          }

          // Optional cleanup
          // await delay(1000);
          // removeFile(dirs);
        } catch (e) {
          console.log("MEGA upload error:", e);
        }
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        // 401 means logged out
        if (statusCode === 401) {
          // If logged out, clean session so next time QR can generate
          removeFile(dirs);
        }
      }
    });

    // ✅ timeout (don’t kill server)
    setTimeout(() => {
      if (!responseSent && !res.headersSent) {
        responseSent = true;
        res.status(408).json({ code: "QR generation timeout" });
      }
    }, 30000);
  } catch (err) {
    console.error("QR init error:", err);
    if (!res.headersSent) res.status(503).json({ code: "Service Unavailable" });
  }
});

export default router;
