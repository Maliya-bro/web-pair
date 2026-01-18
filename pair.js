const express = require('express');
const fs = require('fs');
const { exec } = require("child_process");
let router = express.Router()
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

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;

    async function MalinduPairWeb() {
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        try {
            // ✅ FIX: socket object eka wena variable ekakata danna
            let sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" }).child({ level: "fatal" })
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            if (!sock.authState.creds.registered) {
                await delay(1500);
                num = (num || "").replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(num);
                if (!res.headersSent) {
                    await res.send({ code });
                }
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    try {
                        await delay(10000);

                        const auth_path = './session/';
                        const user_jid = jidNormalizedUser(sock.user.id);

                        function randomMegaId(length = 6, numberLength = 4) {
                            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                            let result = '';
                            for (let i = 0; i < length; i++) {
                                result += characters.charAt(Math.floor(Math.random() * characters.length));
                            }
                            const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                            return `${result}${number}`;
                        }

                        const mega_url = await upload(
                            fs.createReadStream(auth_path + 'creds.json'),
                            `${randomMegaId()}.json`
                        );

                        const sid = mega_url.replace('https://mega.nz/file/', '');

                        await sock.sendMessage(user_jid, { text: sid });

                    } catch (e) {
                        exec('pm2 restart maliya');
                    }

                    await delay(100);
                    await removeFile('./session');
                    process.exit(0);
                }

                else if (
                    connection === "close" &&
                    lastDisconnect &&
                    lastDisconnect.error &&
                    lastDisconnect.error.output &&
                    lastDisconnect.error.output.statusCode !== 401
                ) {
                    await delay(10000);
                    // ✅ FIX: function eka call karanna
                    return MalinduPairWeb();
                }
            });

        } catch (err) {
            exec('pm2 restart maliya-md');
            console.log("service restarted");

            await removeFile('./session');

            if (!res.headersSent) {
                await res.send({ code: "Service Unavailable" });
            }

            // ✅ FIX: retry (but avoid infinite fast loop)
            await delay(2000);
            return MalinduPairWeb();
        }
    }

    return await MalinduPairWeb();
});

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
    exec('pm2 restart maliya');
});

module.exports = router;
