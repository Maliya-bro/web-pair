
import * as mega from "megajs";
import fs from "fs";

const auth = {
    email: "sithmikavihara801@gmail.com",
    password: "@@@iron. spider*man",
    userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246",
};

function attemptUpload(filePath, fileName) {
    return new Promise((resolve, reject) => {
        try {
            const storage = new mega.Storage(auth, (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                const readStream = fs.createReadStream(filePath);

                const uploadStream = storage.upload({
                    name: fileName,
                    allowUploadBuffering: true,
                });

                readStream.pipe(uploadStream);

                uploadStream.on("complete", (file) => {
                    file.link((err, url) => {
                        if (err) {
                            reject(err);
                        } else {
                            storage.close();
                            resolve(url);
                        }
                    });
                });

                uploadStream.on("error", (error) => {
                    reject(error);
                });

                readStream.on("error", (error) => {
                    reject(error);
                });
            });

            storage.on("error", (error) => {
                reject(error);
            });
        } catch (err) {
            reject(err);
        }
    });
}

export const upload = async (filePath, fileName, retries = 3, delayMs = 3000) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await attemptUpload(filePath, fileName);
        } catch (err) {
            const isTransient =
                err?.code === "ERR_INVALID_ARG_TYPE" ||
                (err?.message || "").includes("ERR_INVALID_ARG_TYPE");

            if (attempt < retries && isTransient) {
                console.warn(`⚠️ MEGA upload attempt ${attempt} failed (transient). Retrying in ${delayMs}ms...`);
                await new Promise((r) => setTimeout(r, delayMs));
            } else {
                throw err;
            }
        }
    }
};

export const download = (url) => {
    return new Promise((resolve, reject) => {
        try {
            const file = mega.File.fromURL(url);

            file.loadAttributes((err) => {
                if (err) {
                    reject(err);
                    return;
                }

                file.downloadBuffer((err, buffer) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(buffer);
                    }
                });
            });
        } catch (err) {
            reject(err);
        }
    });
};
