import fs from "fs";
import * as mega from "megajs";

// =======================
// ✅ OPTION 1 (Hardcode)
// =======================
// ⚠️ IMPORTANT: Repo PUBLIC නම් මෙක දාන්න එපා!
// Mega account details
const HARD_EMAIL = "sithmikavihara801@gmail.com";
const HARD_PASSWORD = "@@@iron. spider*man";

// =======================
// ✅ OPTION 2 (Env override)
// If secrets exist, they will override hardcoded values
// =======================
const email = process.env.MEGA_EMAIL || HARD_EMAIL;
const password = process.env.MEGA_PASSWORD || HARD_PASSWORD;

if (!email || !password || email.includes("YOUR_MEGA_EMAIL") || password.includes("YOUR_MEGA_PASSWORD")) {
  console.error("❌ MEGA credentials not set. Edit mega.js OR set MEGA_EMAIL/MEGA_PASSWORD");
}

export async function upload(filePath, name = "creds.json") {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(filePath)) return reject(new Error("File not found: " + filePath));

      // login
      const storage = mega({
        email,
        password,
        // userAgent helps some hosted envs
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      });

      storage.ready
        .then(() => {
          const up = storage.upload({ name });

          fs.createReadStream(filePath)
            .pipe(up)
            .on("complete", (file) => {
              // file.link returns share link
              resolve(file.link);
            })
            .on("error", (err) => reject(err));
        })
        .catch((err) => reject(err));
    } catch (e) {
      reject(e);
    }
  });
              }
