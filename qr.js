import express from "express";
import fs from "fs";
import pino from "pino";
import {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { upload } from "./mega.js";

const router = express.Router();

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
    const match = url.match(/\/file\/([^#]+#[^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ✅ self-jid reliably (publish env වල me id sometimes weird/empty)
function getSelfJid(sock) {
  const raw = sock?.user?.id || sock?.authState?.creds?.me?.id || "";
  const phone = (raw.split(":")[0] || "").replace(/\D/g, "");
  return phone ? `${phone}@s.whatsapp.net` : "";
}

async function safeShutdown(sock, dirs) {
  try {
    await delay(4000); // ✅ delivery time
  } catch {}

  try {
    await sock?.logout();
  } catch {}

  try {
    sock?.end?.();
  } catch {}

  try {
    removeFile(dirs);
  } catch {}
}

router.get("/", async (req, res) => {
  const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  const dirs = `./qr_sessions/session_${sessionId}`;

  if (!fs.existsSync("./qr_sessions")) {
    fs.mkdirSync("./qr_sessions", { recursive: true });
  }

  await removeFile(dirs);

  async function initiateSession() {
    const { state, saveCreds } = await useMultiFileAuthState(dirs);

    try {
      const { version } = await fetchLatestBaileysVersion();

      let responseSent = false;
      let finished = false;
      let restarting = false;

      const KnightBot = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: "fatal" }).child({ level: "fatal" })
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }).child({ level: "fatal" }),
        browser: Browsers.windows("Chrome"),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        retryRequestDelayMs: 250,
        maxRetries: 5,
      });

      KnightBot.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, isNewLogin, isOnline, qr } = update;

        if (qr && !responseSent) {
          console.log("🟢 QR Code Generated! Scan it with your WhatsApp app.");

          try {
            const qrDataURL = await QRCode.toDataURL(qr, {
              errorCorrectionLevel: "M",
              type: "image/png",
              quality: 0.92,
              margin: 1,
              color: { dark: "#000000", light: "#FFFFFF" },
            });

            if (!responseSent) {
              responseSent = true;
              console.log("QR Code sent to client");
              res.send({
                qr: qrDataURL,
                message: "QR Code Generated! Scan it with your WhatsApp app.",
                instructions: [
                  "1. Open WhatsApp on your phone",
                  "2. Go to Settings > Linked Devices",
                  '3. Tap "Link a Device"',
                  "4. Scan the QR code above",
                ],
              });
            }
          } catch (qrError) {
            console.error("Error generating QR code:", qrError);
            if (!responseSent) {
              responseSent = true;
              res.status(500).send({ code: "Failed to generate QR code" });
            }
          }
        }

        if (connection === "open" && !finished) {
          finished = true;

          console.log("✅ Connected successfully!");
          console.log("📱 Uploading session to MEGA...");

          try {
            const credsPath = dirs + "/creds.json";
            const megaUrl = await upload(credsPath, `creds_qr_${sessionId}.json`);
            const megaFileId = getMegaFileId(megaUrl);

            if (megaFileId) {
              console.log("✅ Session uploaded to MEGA. File ID:", megaFileId);

              const userJid = getSelfJid(KnightBot);
              if (userJid) {
                await KnightBot.sendMessage(userJid, { text: `${megaFileId}` });
                console.log("📄 MEGA file ID sent successfully");
              } else {
                console.log("❌ Could not determine user JID");
              }
            } else {
              console.log("❌ Failed to upload to MEGA");
            }

            console.log("🧹 Cleaning up session...");
            await safeShutdown(KnightBot, dirs);
            console.log("✅ Done");
          } catch (error) {
            console.error("❌ Error uploading to MEGA:", error);
            await safeShutdown(KnightBot, dirs);
          }
        }

        if (isNewLogin) console.log("🔐 New login via QR code");
        if (isOnline) console.log("📶 Client is online");

        if (connection === "close") {
          if (finished) return;

          const statusCode = lastDisconnect?.error?.output?.statusCode;

          if (statusCode === 401) {
            console.log("❌ Logged out from WhatsApp. Need to generate new QR code.");
            await safeShutdown(KnightBot, dirs);
            return;
          }

          if (!restarting) {
            restarting = true;
            console.log("🔁 Connection closed — restarting...");
            await delay(1500);
            initiateSession();
          }
        }
      });

      KnightBot.ev.on("creds.update", saveCreds);

      // ✅ QR timeout (but no process.exit)
      setTimeout(async () => {
        if (!responseSent) {
          responseSent = true;
          res.status(408).send({ code: "QR generation timeout" });
          await safeShutdown(KnightBot, dirs);
        }
      }, 30000);
    } catch (err) {
      console.error("Error initializing session:", err);
      if (!res.headersSent) res.status(503).send({ code: "Service Unavailable" });
      removeFile(dirs);
      return;
    }
  }

  await initiateSession();
});

process.on("uncaughtException", (err) => {
  let e = String(err);
  if (e.includes("conflict")) return;
  if (e.includes("not-authorized")) return;
  if (e.includes("Socket connection timeout")) return;
  if (e.includes("rate-overlimit")) return;
  if (e.includes("Connection Closed")) return;
  if (e.includes("Timed Out")) return;
  if (e.includes("Value not found")) return;
  if (e.includes("Stream Errored") || e.includes("Stream Errored (restart required)")) return;
  if (e.includes("statusCode: 515") || e.includes("statusCode: 503")) return;

  console.log("Caught exception: ", err);
  // ❌ publish/deploy වල server kill නොකරන්න
});

export default router;
