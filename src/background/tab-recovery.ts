import { getNetflixPageContext } from "../shared/netflix-url";
import type { PlayerCommand, PlayerResponse } from "../shared/messages";

const recoveryDelayMs = 60;
const recoveryInFlight = new Map<number, Promise<void>>();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isSupportedTab(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number; url: string } {
  if (typeof tab.id !== "number" || typeof tab.url !== "string") {
    return false;
  }

  return getNetflixPageContext(tab.url).isSupportedSite;
}

async function canReachContentScript(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage<PlayerCommand, PlayerResponse>(tabId, { type: "GET_STATE" });
    return Boolean(response);
  } catch {
    return false;
  }
}

async function injectCurrentContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["assets/content.js"],
    world: "ISOLATED"
  });
}

async function recoverSupportedTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!isSupportedTab(tab)) {
    return;
  }

  if (await canReachContentScript(tab.id)) {
    return;
  }

  const existingRecovery = recoveryInFlight.get(tab.id);
  if (existingRecovery) {
    await existingRecovery;
    return;
  }

  const recovery = (async () => {
    try {
      await injectCurrentContentScript(tab.id);
      await delay(recoveryDelayMs);
    } catch {
      // Navigation can replace a tab while recovery is in progress. The background
      // polling/retry path will try again when the new document becomes available.
    } finally {
      recoveryInFlight.delete(tab.id);
    }
  })();

  recoveryInFlight.set(tab.id, recovery);
  await recovery;
}

async function recoverActiveSupportedTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) {
      await recoverSupportedTab(tab);
    }
  } catch {
    // A browser window can disappear while the service worker is waking up.
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then(recoverSupportedTab).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab.active) {
    return;
  }

  if (changeInfo.url !== undefined || changeInfo.status === "complete") {
    void recoverSupportedTab(tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  recoveryInFlight.delete(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    void recoverActiveSupportedTab();
  }
});

void recoverActiveSupportedTab();
