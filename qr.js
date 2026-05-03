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
import { saveSessionState } from "./mongodb.js";
import { setSessionId } from "./session-store.js";

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
    const tempId =
        Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const sessionId = generateMegaStyleId();
    const dirs = `./qr_sessions/session_${tempId}`;

    if (!fs.existsSync("./qr_sessions")) {
        fs.mkdirSync("./qr_sessions", { recursive: true });
    }

    await removeFile(dirs);

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let responseSent = false;

            const KnightBot = makeWASocket({
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
                maxRetries: 5,
            });

            const timeoutHandle = setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    if (!res.headersSent) {
                        res.status(408).send({ code: "QR generation timeout" });
                    }
                    KnightBot.ev.removeAllListeners();
                    try {
                        KnightBot.ws.close();
                    } catch (_) {}
                    removeFile(dirs);
                }
            }, 30000);

            KnightBot.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline, qr } =
                    update;

                if (qr && !responseSent) {
                    console.log(
                        "🟢 QR Code Generated! Scan it with your WhatsApp app.",
                    );

                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, {
                            errorCorrectionLevel: "M",
                            type: "image/png",
                            quality: 0.92,
                            margin: 1,
                            color: {
                                dark: "#000000",
                                light: "#FFFFFF",
                            },
                        });

                        if (!responseSent) {
                            responseSent = true;
                            console.log("QR Code sent to client");
                            res.send({
                                qr: qrDataURL,
                                message:
                                    "QR Code Generated! Scan it with your WhatsApp app.",
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
                            res.status(500).send({
                                code: "Failed to generate QR code",
                            });
                        }
                    }
                }

                if (connection === "open") {
                    clearTimeout(timeoutHandle);
                    console.log("✅ Connected successfully!");
                    console.log("📱 Uploading session to MongoDB...");

                    try {
                        const credsPath = dirs + "/creds.json";
                        const savedSessionId = await saveSessionState({
                            sessionId,
                            filePath: credsPath,
                            fileName: `creds_qr_${tempId}.json`,
                            source: "qr",
                        });

                        console.log(
                            "✅ Session uploaded to MongoDB. Session ID:",
                            savedSessionId,
                        );
                        setSessionId(savedSessionId);

                        console.log("🧹 Cleaning up session...");
                        await delay(1000);
                        KnightBot.ev.removeAllListeners();
                        try {
                            await KnightBot.ws.close();
                        } catch (_) {}
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                        console.log("🎉 Process completed successfully!");
                    } catch (error) {
                        console.error("❌ Error uploading to MongoDB:", error);
                        KnightBot.ev.removeAllListeners();
                        try {
                            await KnightBot.ws.close();
                        } catch (_) {}
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via QR code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === "close") {
                    const statusCode =
                        lastDisconnect?.error?.output?.statusCode;
                    const reason = lastDisconnect?.error?.message || "unknown";
                    console.log(
                        `🔴 Connection closed. Code: ${statusCode}, Reason: ${reason}`,
                    );

                    if (statusCode === 401) {
                        console.log(
                            "❌ Logged out from WhatsApp. Need to generate new QR code.",
                        );
                    } else {
                        KnightBot.ev.removeAllListeners();
                        try {
                            KnightBot.ws.close();
                        } catch (_) {}
                        const reconnectDelay = String(reason)
                            .toLowerCase()
                            .includes("conflict")
                            ? 8000
                            : 3000;
                        console.log(
                            `🔁 Reconnecting in ${reconnectDelay / 1000}s...`,
                        );
                        await delay(reconnectDelay);
                        console.log("🔄 Calling initiateSession...");
                        try {
                            await initiateSession();
                        } catch (e) {
                            console.error("❌ initiateSession error:", e);
                        }
                    }
                }
            });

            KnightBot.ev.on("creds.update", saveCreds);
            KnightBot.ev.on("connection.update", () => {
                if (responseSent) clearTimeout(timeoutHandle);
            });
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
