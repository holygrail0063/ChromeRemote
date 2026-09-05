import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = process.cwd();
const remoteDistDir = resolve(rootDir, "remote", "dist");
const indexPath = resolve(remoteDistDir, "index.html");

await access(indexPath);

const html = await readFile(indexPath, "utf8");
const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((assetPath) => assetPath.startsWith("/assets/"));

if (assetPaths.length === 0) {
  throw new Error("Railway build is missing remote app assets in remote/dist/index.html.");
}

for (const assetPath of assetPaths) {
  await access(resolve(remoteDistDir, assetPath.replace(/^\//, "")));
}
