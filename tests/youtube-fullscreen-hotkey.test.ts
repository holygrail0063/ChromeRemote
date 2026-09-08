import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("YouTube fullscreen uses Chrome debugger input to press F", () => {
  const hotkey = source("src/background/youtube-hotkey.ts");
  const background = source("src/background/background.ts");
  const manifest = JSON.parse(source("public/manifest.json")) as { permissions?: string[] };

  assert.match(hotkey, /chrome\.debugger\.attach/);
  assert.match(hotkey, /Input\.dispatchKeyEvent/);
  assert.match(hotkey, /rawKeyDown/);
  assert.match(hotkey, /keyUp/);
  assert.match(hotkey, /key: "f"/);
  assert.match(hotkey, /code: "KeyF"/);
  assert.match(hotkey, /chrome\.debugger\.detach/);
  assert.match(hotkey, /document\.activeElement/);

  assert.match(background, /active\.site === "youtube"/);
  assert.match(background, /pressYouTubeFullscreenHotkey\(tabId\)/);
  assert.match(background, /ENTER_PLAYER_FULLSCREEN/);
  assert.ok(manifest.permissions?.includes("debugger"));
});

test("YouTube debugger hotkey path does not replace Netflix fullscreen routing", () => {
  const background = source("src/background/background.ts");

  assert.match(background, /return await sendTabMessage\(active\.tabId, command\)/);
  assert.doesNotMatch(background, /active\.site === "netflix"[\s\S]{0,160}pressYouTubeFullscreenHotkey/);
});
