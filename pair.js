// ========================== pair.js (FULL FIXED) ==========================
// ✅ Pair Code issue fix: requestPairingCode() now runs ONLY after socket starts connecting / qr event happens.
// ✅ Your MEGA upload + cleanup + exit logic kept as-is.

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
    // Extract everything after /file/ including the key
    const match = url.match(/\/file\/([^#]+#[^\/]+)/);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  let dirs = "./" + (num || `session`);

  await removeFile(dirs);

  // ✅ safe sanitize
  num = (num || "").toString().replace(/[^0-9]/g, "");

  // ✅ awesome-phonenumber validity check (supports both isValidNumber / isValid)
  const phone = pn("+" + num);
  const valid =
    typeof phone.isValidNumber === "function"
      ? phone.isValidNumber()
      : typeof phone.isValid === "function"
      ? phone.isValid()
      : false;

  if (!valid) {
    if (!res.headersSent) {
      return res.status(400).send({
        code:
          "Invalid phone number. Please enter your full international number (e.g., 947xxxxxxx or +947xxxxxxxx.)",
      });
    }
    return;
  }

  // ✅ normalize to E164 digits-only
  num = phone.getNumber("e164").replace("+", "");

  async function initiateSession() {
    const { state, saveCreds } = await useMultiFileAuthState(dirs);

    try {
      const { version } = await fetchLatestBaileysVersion();

      let KnightBot = makeWASocket({
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

      // ✅ IMPORTANT: pairing code request must happen after connecting/qr event
      let pairingRequested = false;

      KnightBot.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, isNewLogin, isOnline, qr } = update;

        // ✅ Request Pairing Code at correct time
        if (!KnightBot.authState.creds.registered && !pairingRequested) {
          // wait until socket begins connecting OR a qr event appears
          if (connection === "connecting" || !!qr) {
            pairingRequested = true;
            try {
              let code = await KnightBot.requestPairingCode(num);
              code = code?.match(/.{1,4}/g)?.join("-") || code;

              if (!res.headersSent) {
                console.log({ num, code });
                await res.send({ code });
              }
            } catch (error) {
              console.error("Error requesting pairing code:", error);
              pairingRequested = false; // allow retry if reconnect happens

              if (!res.headersSent) {
                res.status(503).send({
                  code: "Error generating code. Please try again.",
                });
              }

              // if it fails badly, exit (same behavior style as your code)
              setTimeout(() => process.exit(1), 2000);
              return;
            }
          }
        }

        if (connection === "open") {
          console.log("✅ Connected successfully!");
          console.log("📱 Uploading session to MEGA...");

          try {
            const credsPath = dirs + "/creds.json";
            const megaUrl = await upload(
              credsPath,
              `creds_${num}_${Date.now()}.json`
            );
            const megaFileId = getMegaFileId(megaUrl);

            if (megaFileId) {
              console.log("✅ Session uploaded to MEGA. File ID:", megaFileId);

              const userJid = jidNormalizedUser(num + "@s.whatsapp.net");
              await KnightBot.sendMessage(userJid, { text: `${megaFileId}` });
              console.log("📄 MEGA file ID sent successfully");
            } else {
              console.log("❌ Failed to upload to MEGA");
            }

            console.log("🧹 Cleaning up session...");
            await delay(1000);
            removeFile(dirs);
            console.log("✅ Session cleaned up successfully");
            console.log("🎉 Process completed successfully!");

            console.log("🛑 Shutting down application...");
            await delay(2000);
            process.exit(0);
          } catch (error) {
            console.error("❌ Error uploading to MEGA:", error);
            removeFile(dirs);
            await delay(2000);
            process.exit(1);
          }
        }

        if (isNewLogin) {
          console.log("🔐 New login via pair code");
        }

        if (isOnline) {
          console.log("📶 Client is online");
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;

          if (statusCode === 401) {
            console.log(
              "❌ Logged out from WhatsApp. Need to generate new pair code."
            );
          } else {
            console.log("🔁 Connection closed — restarting...");
            pairingRequested = false; // allow re-request after reconnect
            initiateSession();
          }
        }
      });

      KnightBot.ev.on("creds.update", saveCreds);
    } catch (err) {
      console.error("Error initializing session:", err);
      if (!res.headersSent) {
        res.status(503).send({ code: "Service Unavailable" });
      }
      setTimeout(() => process.exit(1), 2000);
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
  if (
    e.includes("Stream Errored") ||
    e.includes("Stream Errored (restart required)")
  )
    return;
  if (e.includes("statusCode: 515") || e.includes("statusCode: 503")) return;
  console.log("Caught exception: ", err);
  process.exit(1);
});

export default router;
