import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = process.cwd();
const distDir = resolve(rootDir, "dist");
const classicScriptPaths = [
  resolve(distDir, "assets/content.js"),
  resolve(distDir, "assets/netflix-adapter.js")
];

const moduleSyntaxPattern = /(^|\n)\s*(import(?:[\s{*(]|\w)|export(?:\s|[{*]))|\bimport\s*\(/;
const currentTimeWritePattern = /\.currentTime\s*=|currentTime\s*\+=|currentTime\s*-=|currentTime=/;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const scriptPath of classicScriptPaths) {
  assert(existsSync(scriptPath), `${scriptPath} does not exist.`);
  const source = await readFile(scriptPath, "utf8");
  assert(!moduleSyntaxPattern.test(source), `${scriptPath} contains ES module syntax.`);
  assert(!currentTimeWritePattern.test(source), `${scriptPath} contains a direct currentTime write.`);
}

for (const sourcePath of ["src", "tests", "public"]) {
  const files = await collectFiles(resolve(rootDir, sourcePath));
  for (const file of files) {
    if (!/\.(ts|tsx|js|json|md)$/.test(file)) {
      continue;
    }

    const source = await readFile(file, "utf8");
    assert(!currentTimeWritePattern.test(source), `${file} contains a direct currentTime write.`);
  }
}

const manifestPath = resolve(distDir, "manifest.json");
assert(existsSync(manifestPath), "dist/manifest.json does not exist.");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
for (const contentScript of manifest.content_scripts ?? []) {
  for (const jsPath of contentScript.js ?? []) {
    const absoluteJsPath = resolve(distDir, jsPath);
    assert(existsSync(absoluteJsPath), `Manifest references missing content script: ${jsPath}`);
  }
}

if (manifest.background?.service_worker) {
  const serviceWorkerPath = resolve(distDir, manifest.background.service_worker);
  assert(existsSync(serviceWorkerPath), `Manifest references missing service worker: ${manifest.background.service_worker}`);
}

if (manifest.action?.default_popup) {
  const popupPath = resolve(distDir, manifest.action.default_popup);
  assert(existsSync(popupPath), `Manifest references missing popup: ${manifest.action.default_popup}`);
}

async function collectFiles(path) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childPath = resolve(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(childPath)));
    } else {
      files.push(childPath);
    }
  }

  return files;
}
