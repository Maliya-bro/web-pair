const express = require('express');
const fs = require('fs');
const { exec } = require("child_process");
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require("@whiskeysockets/baileys");

const { upload } = require('./mega');

const router = express.Router();

/* ================= HELPER ================= */

function removeFile(path) {
    if (!fs.existsSync(path)) return;
    fs.rmSync(path, { recursive: true, force: true });
}

function randomMegaId(length = 6, numberLength = 4) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';
    for (let i = 0; i < length; i++) {
        res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const num = Math.floor(Math.random() * Math.pow(10, numberLength));
    return `${res}${num}`;
}

/* ================= ROUTE ================= */

router.get('/', async (req, res) => {
    let num = req.query.number;

    async function startBot() {
        const { state, saveCreds } = await useMultiFileAuthState('./session');

        try {
            const sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" })
                    )
                },
                logger: pino({ level: "fatal" }),
                printQRInTerminal: false,
                browser: Browsers.macOS("Safari")
            });

            /* ---------- Pair Code ---------- */
            if (!sock.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(num);
                if (!res.headersSent) res.send({ code });
            }

            sock.ev.on("creds.update", saveCreds);

            /* ---------- Connection ---------- */
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    try {
                        await delay(10000);

                        const userJid = jidNormalizedUser(sock.user.id);

                        const megaUrl = await upload(
                            fs.createReadStream('./session/creds.json'),
                            `${randomMegaId()}.json`
                        );

                        const sessionId = megaUrl.replace(
                            'https://mega.nz/file/',
                            ''
                        );

                        await sock.sendMessage(userJid, {
                            text: sessionId
                        });

                    } catch (err) {
                        console.log(err);
                        exec('pm2 restart maliya');
                    }

                    await delay(200);
                    removeFile('./session');
                    process.exit(0);
                }

                /* ---------- Reconnect ---------- */
                if (
                    connection === "close" &&
                    lastDisconnect?.error?.output?.statusCode !== 401
                ) {
                    await delay(5000);
                    startBot();
                }
            });

        } catch (err) {
            console.log(err);
            exec('pm2 restart maliya-md');
            removeFile('./session');
            if (!res.headersSent) {
                res.send({ code: "Service Unavailable" });
            }
        }
    }

    return await startBot();
});

/* ================= GLOBAL ERROR ================= */

process.on('uncaughtException', (err) => {
    console.log('Caught exception:', err);
    exec('pm2 restart maliya');
});

module.exports = router;
