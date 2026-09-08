const DEBUGGER_PROTOCOL_VERSION = "1.3";

function keyEventParams(type: "rawKeyDown" | "keyUp") {
  return {
    type,
    key: "f",
    code: "KeyF",
    windowsVirtualKeyCode: 70,
    nativeVirtualKeyCode: 70,
    modifiers: 0,
    autoRepeat: false,
    isKeypad: false,
    isSystemKey: false
  };
}

export async function pressYouTubeFullscreenHotkey(tabId: number): Promise<void> {
  const debuggee: chrome.debugger.Debuggee = { tabId };
  let attached = false;

  try {
    await chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION);
    attached = true;

    // YouTube ignores its F shortcut while a text field is focused. Blur any focused
    // control first, then send a browser-level key event through the Chrome DevTools
    // Protocol so YouTube receives the same trusted keyboard path as a physical F key.
    await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
      expression: "document.activeElement instanceof HTMLElement && document.activeElement.blur()",
      returnByValue: true
    });

    await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", keyEventParams("rawKeyDown"));
    await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", keyEventParams("keyUp"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `ChromeRemote could not send YouTube's F fullscreen hotkey. ${message || "Chrome debugger input was unavailable."}`
    );
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch {
        // Detach is best-effort; Chrome also detaches automatically if the tab closes.
      }
    }
  }
}
