const express = require('express');
const fs = require('fs');
const { exec } = require("child_process");
const pino = require("pino");

const router = express.Router();

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require("@whiskeysockets/baileys");

const { upload } = require('./mega');

/* ------------------ HELPERS ------------------ */

function removeFile(path) {
    if (fs.existsSync(path)) {
        fs.rmSync(path, { recursive: true, force: true });
    }
}

function randomMegaId(length = 6, numberLength = 4) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const number = Math.floor(Math.random() * Math.pow(10, numberLength));
    return `${result}${number}`;
}

/* ------------------ ROUTE ------------------ */

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });

    async function startPairWeb() {
        const { state, saveCreds } = await useMultiFileAuthState('./session');

        try {
            const sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" })
                    ),
                },
                logger: pino({ level: "fatal" }),
                printQRInTerminal: false,
                browser: Browsers.macOS("Safari"),
            });

            /* ---------- PAIR CODE ---------- */
            if (!sock.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(num);
                if (!res.headersSent) {
                    res.json({ code });
                }
            }

            sock.ev.on('creds.update', saveCreds);

            /* ---------- CONNECTION ---------- */
            sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {

                if (connection === "open") {
                    try {
                        await delay(10000);

                        const authPath = './session/creds.json';
                        const userJid = jidNormalizedUser(sock.user.id);

                        const megaUrl = await upload(
                            fs.createReadStream(authPath),
                            `${randomMegaId()}.json`
                        );

                        const sessionId = megaUrl.replace('https://mega.nz/file/', '');

                        await sock.sendMessage(userJid, { text: sessionId });

                    } catch (err) {
                        console.error("Upload error:", err);
                        exec('pm2 restart danuwa');
                    }

                    await delay(200);
                    removeFile('./session');
                    process.exit(0);
                }

                /* ---------- RECONNECT ---------- */
                if (
                    connection === "close" &&
                    lastDisconnect?.error?.output?.statusCode !== 401
                ) {
                    await delay(5000);
                    startPairWeb();
                }
            });

        } catch (err) {
            console.error("Fatal error:", err);
            exec('pm2 restart danuwa-md');
            removeFile('./session');
            if (!res.headersSent) {
                res.status(503).json({ code: "Service Unavailable" });
            }
        }
    }

    await startPairWeb();
});

/* ------------------ GLOBAL ERROR ------------------ */

process.on('uncaughtException', (err) => {
    console.log('Caught exception:', err);
    exec('pm2 restart danuwa');
});

module.exports = router;
