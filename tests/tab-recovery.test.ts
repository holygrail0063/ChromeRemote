import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("background bootstraps self-healing content recovery", () => {
  const entry = source("src/background/entry.ts");
  const recovery = source("src/background/tab-recovery.ts");
  const buildScript = source("scripts/build-extension.mjs");
  const manifest = JSON.parse(source("public/manifest.json")) as { permissions?: string[] };

  assert.match(entry, /import "\.\/tab-recovery"/);
  assert.match(entry, /import "\.\/background"/);
  assert.match(buildScript, /src\/background\/entry\.ts/);

  assert.match(recovery, /chrome\.tabs\.sendMessage/);
  assert.match(recovery, /type: "GET_STATE"/);
  assert.match(recovery, /chrome\.scripting\.executeScript/);
  assert.match(recovery, /files: \["assets\/content\.js"\]/);
  assert.match(recovery, /world: "ISOLATED"/);
  assert.match(recovery, /chrome\.tabs\.onActivated/);
  assert.match(recovery, /chrome\.tabs\.onUpdated/);
  assert.match(recovery, /chrome\.windows\.onFocusChanged/);
  assert.ok(manifest.permissions?.includes("scripting"));
});

test("tab recovery does not dynamically inject the Netflix MAIN-world adapter", () => {
  const recovery = source("src/background/tab-recovery.ts");

  assert.doesNotMatch(recovery, /netflix-adapter\.js/);
  assert.doesNotMatch(recovery, /world: "MAIN"/);
});
