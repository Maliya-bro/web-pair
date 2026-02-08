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
    const match = url.match(/\/file\/([^#]+#[^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function safeShutdown(sock, dirs) {
  try {
    // ✅ give WhatsApp time to actually deliver the message (publish env වල මෙයම main fix එක)
    await delay(4000);
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
  let num = req.query.number;
  let dirs = "./" + (num || `session`);

  await removeFile(dirs);

  if (!num) {
    if (!res.headersSent) return res.status(400).send({ code: "Missing number" });
    return;
  }

  num = num.replace(/[^0-9]/g, "");

  const phone = pn("+" + num);
  if (!phone.isValid()) {
    if (!res.headersSent) {
      return res.status(400).send({
        code: "Invalid phone number. Please enter your full international number (e.g., 15551234567) without + or spaces.",
      });
    }
    return;
  }

  num = phone.getNumber("e164").replace("+", "");

  async function initiateSession() {
    const { state, saveCreds } = await useMultiFileAuthState(dirs);

    try {
      const { version } = await fetchLatestBaileysVersion();

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
        const { connection, lastDisconnect, isNewLogin, isOnline } = update;

        if (connection === "open" && !finished) {
          finished = true;

          console.log("✅ Connected successfully!");
          console.log("📱 Uploading session to MEGA...");

          try {
            const credsPath = dirs + "/creds.json";
            const megaUrl = await upload(credsPath, `creds_${num}_${Date.now()}.json`);
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
            await safeShutdown(KnightBot, dirs);
            console.log("✅ Done");
          } catch (error) {
            console.error("❌ Error uploading to MEGA:", error);
            await safeShutdown(KnightBot, dirs);
          }
        }

        if (isNewLogin) console.log("🔐 New login via pair code");
        if (isOnline) console.log("📶 Client is online");

        if (connection === "close") {
          if (finished) return;

          const statusCode = lastDisconnect?.error?.output?.statusCode;

          if (statusCode === 401) {
            console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
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

      if (!KnightBot.authState.creds.registered) {
        await delay(3000);

        let cleanNum = num.replace(/[^\d+]/g, "");
        if (cleanNum.startsWith("+")) cleanNum = cleanNum.substring(1);

        try {
          let code = await KnightBot.requestPairingCode(cleanNum);
          code = code?.match(/.{1,4}/g)?.join("-") || code;

          if (!res.headersSent) {
            console.log({ num: cleanNum, code });
            await res.send({ code });
          }
        } catch (error) {
          console.error("Error requesting pairing code:", error);
          if (!res.headersSent) {
            res.status(503).send({
              code: "Failed to get pairing code. Please check your phone number and try again.",
            });
          }
          await safeShutdown(KnightBot, dirs);
          return;
        }
      }

      KnightBot.ev.on("creds.update", saveCreds);
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
