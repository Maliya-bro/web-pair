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
import pn from "awesome-phonenumber";
import { upload } from "./mega.js";

const router = express.Router();
const ACTIVE = new Map(); // one socket per number

function rm(p) {
  try { fs.existsSync(p) && fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

async function cleanup(num) {
  const cur = ACTIVE.get(num);
  if (!cur) return;
  ACTIVE.delete(num);
  try { await cur.sock.end(); } catch {}
  await delay(1500);
  rm(cur.dir);
}

async function waitFile(f, t = 30000) {
  const s = Date.now();
  while (Date.now() - s < t) {
    if (fs.existsSync(f)) return true;
    await delay(300);
  }
  return false;
}

router.get("/", async (req, res) => {
  let num = String(req.query.number || "").replace(/\D/g, "");
  if (!num) return res.json({ code: "Invalid number" });

  const phone = pn("+" + num);
  if (!phone.isValid()) return res.json({ code: "Invalid number" });

  num = phone.getNumber("e164").replace("+", "");
  const dir = "./session_" + num;

  if (ACTIVE.has(num)) await cleanup(num);
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
    browser: Browsers.windows("Chrome")
  });

  ACTIVE.set(num, { sock, dir });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async () => {
    if (sock.authState.creds.registered) {
      await saveCreds();
      const creds = dir + "/creds.json";
      if (await waitFile(creds)) {
        try {
          const url = await upload(creds, `creds_${num}.json`);
          await sock.sendMessage(jidNormalizedUser(num + "@s.whatsapp.net"), {
            text: url
          });
        } catch {}
      }
      await cleanup(num);
    }
  });

  await delay(1200);
  const raw = await sock.requestPairingCode(num);
  const code = raw.match(/.{1,4}/g).join("-");
  res.json({ code });
});

export default router;
