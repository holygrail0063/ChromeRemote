import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build, loadEnv } from "vite";

const rootDir = process.cwd();
const distDir = resolve(rootDir, "dist");
const mode = process.env.MODE ?? process.env.NODE_ENV ?? "production";
Object.assign(process.env, loadEnv(mode, rootDir, ""));
process.env.VITE_CHROMEREMOTE_BUILD_ID = process.env.VITE_CHROMEREMOTE_BUILD_ID ?? getBuildId();

const DEFAULT_PRODUCTION_HTTP_ORIGIN = "https://chromeremote-production.up.railway.app";
const assetNames = {
  entryFileNames: "assets/[name].js",
  chunkFileNames: "assets/[name].js",
  assetFileNames: "assets/[name][extname]"
};

function getBuildId() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
  }
}

function relayHostPermission() {
  const origin = process.env.VITE_REMOTE_HTTP_ORIGIN ?? DEFAULT_PRODUCTION_HTTP_ORIGIN;
  const url = new URL(origin);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VITE_REMOTE_HTTP_ORIGIN must use http or https.");
  }

  return `${url.origin}/*`;
}

await build({
  configFile: false,
  root: rootDir,
  publicDir: resolve(rootDir, "public"),
  plugins: [react()],
  define: {
    "import.meta.env.VITE_REMOTE_HTTP_ORIGIN": JSON.stringify(process.env.VITE_REMOTE_HTTP_ORIGIN ?? DEFAULT_PRODUCTION_HTTP_ORIGIN),
    "import.meta.env.VITE_REMOTE_WS_ORIGIN": JSON.stringify(
      process.env.VITE_REMOTE_WS_ORIGIN ??
        (process.env.VITE_REMOTE_HTTP_ORIGIN ?? DEFAULT_PRODUCTION_HTTP_ORIGIN).replace(/^https:/, "wss:").replace(/^http:/, "ws:")
    ),
    "import.meta.env.VITE_REMOTE_WEB_ORIGIN": JSON.stringify(process.env.VITE_REMOTE_WEB_ORIGIN ?? process.env.VITE_REMOTE_HTTP_ORIGIN ?? DEFAULT_PRODUCTION_HTTP_ORIGIN)
  },
  build: {
    outDir: distDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(rootDir, "popup.html")
      },
      output: assetNames
    }
  }
});

await mkdir(resolve(distDir, "assets"), { recursive: true });

const manifestPath = resolve(distDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions = ["https://www.netflix.com/*", relayHostPermission()];
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

for (const entry of [
  { name: "ChromeRemoteContent", fileName: "content", path: "src/content/content.ts" },
  { name: "ChromeRemoteNetflixAdapter", fileName: "netflix-adapter", path: "src/netflix/main-world-adapter.ts" },
  { name: "ChromeRemoteBackground", fileName: "background", path: "src/background/background.ts" }
]) {
  await build({
    configFile: false,
    root: rootDir,
    publicDir: false,
    define: {
      "import.meta.env.VITE_REMOTE_HTTP_ORIGIN": JSON.stringify(process.env.VITE_REMOTE_HTTP_ORIGIN ?? DEFAULT_PRODUCTION_HTTP_ORIGIN),
      "import.meta.env.VITE_REMOTE_WS_ORIGIN": JSON.stringify(
        process.env.VITE_REMOTE_WS_ORIGIN ??
          (process.env.VITE_REMOTE_HTTP_ORIGIN ?? DEFAULT_PRODUCTION_HTTP_ORIGIN).replace(/^https:/, "wss:").replace(/^http:/, "ws:")
      ),
      "import.meta.env.VITE_REMOTE_WEB_ORIGIN": JSON.stringify(process.env.VITE_REMOTE_WEB_ORIGIN ?? process.env.VITE_REMOTE_HTTP_ORIGIN ?? DEFAULT_PRODUCTION_HTTP_ORIGIN)
    },
    build: {
      outDir: distDir,
      emptyOutDir: false,
      minify: true,
      lib: {
        entry: resolve(rootDir, entry.path),
        name: entry.name,
        formats: ["iife"],
        fileName: () => `assets/${entry.fileName}.js`
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true
        }
      }
    }
  });
}
