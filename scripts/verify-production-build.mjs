import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = process.cwd();
const productionOrigin = "https://chromeremote-production.up.railway.app";
const files = [
  "dist/manifest.json",
  "dist/assets/background.js",
  "dist/assets/popup.js",
  "dist/assets/content.js",
  "dist/assets/netflix-adapter.js"
];

const forbiddenPatterns = [/localhost:8787/, /127\.0\.0\.1/, /your-railway-domain/];

for (const file of files) {
  const text = await readFile(resolve(rootDir, file), "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text)) {
      throw new Error(`Production build contains forbidden value ${pattern} in ${file}.`);
    }
  }
}

const manifest = JSON.parse(await readFile(resolve(rootDir, "dist/manifest.json"), "utf8"));
if (!manifest.host_permissions?.includes(`${productionOrigin}/*`)) {
  throw new Error("Production manifest is missing the ChromeRemote Railway host permission.");
}

const background = await readFile(resolve(rootDir, "dist/assets/background.js"), "utf8");
if (!background.includes(productionOrigin) || !background.includes("wss://chromeremote-production.up.railway.app")) {
  throw new Error("Production background bundle does not point to the ChromeRemote Railway origin.");
}
