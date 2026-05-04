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
import { phone as validatePhone } from "phone";
import { saveSessionState } from "./mongodb.js";

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error("Error removing file:", e);
    }
}

function generateMegaStyleId() {
    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    function randomString(len) {
        let str = "";
        for (let i = 0; i < len; i++) {
            str += chars[Math.floor(Math.random() * chars.length)];
        }
        return str;
    }

    const fileId = randomString(8);
    const fileKey = randomString(43);

    return `${fileId}#${fileKey}`;
}

router.get("/", async (req, res) => {
    let num = req.query.number;
    if (!num) {
        return res.status(400).send({ code: "Phone number is required." });
    }

    let dirs = "./" + (num || "session");
    await removeFile(dirs);

    num = String(num).replace(/[^0-9]/g, "");

    const phoneResult = validatePhone("+" + num);
    if (!phoneResult.isValid) {
        if (!res.headersSent) {
            return res.status(400).send({
                code: "Invalid phone number. Please enter your full international number without + or spaces.",
            });
        }
        return;
    }

    num = phoneResult.phoneNumber.replace("+", "");
    const sessionId = generateMegaStyleId();

    let codeSent = false;
    let sessionDone = false;

    async function initiateSession() {
        if (sessionDone) return;

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" }).child({ level: "fatal" }),
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
                maxRetries: 3,
            });

            KnightBot.ev.on("connection.update", async (update) => {
                if (sessionDone) return;

                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === "open") {
                    sessionDone = true;
                    console.log("✅ Connected — uploading session to MongoDB...");

                    try {
                        const credsPath = dirs + "/creds.json";
                        const savedSessionId = await saveSessionState({
                            sessionId,
                            phone: num,
                            filePath: credsPath,
                            fileName: `creds_${num}_${Date.now()}.json`,
                            source: "pair-code",
                        });

                        console.log("✅ Session saved. ID:", savedSessionId);

                        await delay(1500);
                        KnightBot.ev.removeAllListeners();
                        try { await KnightBot.ws.close(); } catch (_) {}
                        removeFile(dirs);
                        console.log("🎉 Done!");
                    } catch (error) {
                        console.error("❌ MongoDB upload error:", error);
                        KnightBot.ev.removeAllListeners();
                        try { await KnightBot.ws.close(); } catch (_) {}
                        removeFile(dirs);
                    }
                    return;
                }

                if (isNewLogin) console.log("🔐 New login via pair code");

                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = lastDisconnect?.error?.message || "unknown";
                    console.log(`🔴 Connection closed. Code: ${statusCode}, Reason: ${reason}`);

                    if (statusCode === 401 || sessionDone) {
                        console.log("❌ Session ended — not reconnecting.");
                        if (!sessionDone) removeFile(dirs);
                        return;
                    }

                    if (codeSent) {
                        console.log("⚠️ Code was already sent — reconnecting to await pairing confirmation.");
                    } else {
                        console.log("🔁 Reconnecting before code was sent...");
                    }

                    KnightBot.ev.removeAllListeners();
                    try { KnightBot.ws.close(); } catch (_) {}

                    const reconnectDelay = String(reason).toLowerCase().includes("conflict") ? 8000 : 3000;
                    await delay(reconnectDelay);

                    try { await initiateSession(); } catch (e) {
                        console.error("❌ Reconnect error:", e);
                    }
                }
            });

            if (!KnightBot.authState.creds.registered && !codeSent) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, "");
                if (num.startsWith("+")) num = num.substring(1);

                try {
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    codeSent = true;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error("Error requesting pairing code:", error);
                    if (!res.headersSent) {
                        res.status(503).send({
                            code: "Failed to get pairing code. Please check your number and try again.",
                        });
                    }
                    sessionDone = true;
                    KnightBot.ev.removeAllListeners();
                    try { KnightBot.ws.close(); } catch (_) {}
                    removeFile(dirs);
                }
            }

            KnightBot.ev.on("creds.update", saveCreds);
        } catch (err) {
            console.error("Error initializing session:", err);
            if (!res.headersSent) {
                res.status(503).send({ code: "Service Unavailable" });
            }
            removeFile(dirs);
        }
    }

    await initiateSession();
});

export default router;
