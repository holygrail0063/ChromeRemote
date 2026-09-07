import { REMOTE_HTTP_ORIGIN, REMOTE_WS_ORIGIN } from "../shared/remote-config";
import { getNetflixPageContext, type SupportedPlayerSite } from "../shared/netflix-url";
import type { PlayerCommand, PlayerResponse } from "../shared/messages";
import { unavailablePlayerState, type PlayerState } from "../shared/player-state";
import {
  encodePairingPayload,
  isCreateRemoteSessionResponse,
  isPairingRequest,
  isValidRemoteOrigin,
  validateControllerUrl,
  type PairingErrorCode,
  type PairingRequest,
  type PairingResponse,
  type PairingState
} from "../shared/pairing";
import { parseRemoteMessage, toRemoteErrorCode, type RemoteServerMessage } from "../shared/remote-protocol";

type StoredPairing = {
  sessionId: string;
  playerToken: string;
  remoteUrl: string;
  pairingPayload: string;
  expiresAt: string;
};

type ActiveSupportedTab = {
  tab: chrome.tabs.Tab;
  tabId: number;
  site: SupportedPlayerSite;
};

const storageKey = "chromeRemotePairing";
const stateIntervalMs = 750;
const reconnectDelaysMs = [1000, 2000, 5000, 10000, 30000];
const contentMessageRetryDelaysMs = [0, 125, 300, 600];

let pairingState: PairingState = { status: "not-paired" };
let storedPairing: StoredPairing | null = null;
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let pollingTimer: number | null = null;
let reconnectAttempt = 0;
let disconnecting = false;
let lastActiveSupportedTabId: number | null = null;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeText({ text: "" });
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function setPairingState(nextState: PairingState): void {
  pairingState = nextState;
  try {
    const result = chrome.runtime.sendMessage({ type: "PAIRING_STATE_CHANGED", state: pairingState });
    if (result && typeof result === "object" && "catch" in result && typeof result.catch === "function") {
      result.catch(() => undefined);
    }
  } catch {
    // The popup may be closed; pairing state remains owned by the service worker.
  }
}

function pairingError(errorCode: PairingErrorCode, error: string, state: PairingState = pairingState): PairingResponse {
  return { ok: false, state: { ...state, errorCode, error }, errorCode, error };
}

function sessionState(status: PairingState["status"], pairing: StoredPairing, activeTabId?: number): PairingState {
  return {
    status,
    sessionId: pairing.sessionId,
    remoteUrl: pairing.remoteUrl,
    pairingPayload: pairing.pairingPayload,
    expiresAt: pairing.expiresAt,
    activeTabId
  };
}

async function savePairing(pairing: StoredPairing | null): Promise<void> {
  storedPairing = pairing;
  if (pairing) {
    await chrome.storage.session.set({ [storageKey]: pairing });
    return;
  }

  await chrome.storage.session.remove(storageKey);
}

async function loadPairing(): Promise<StoredPairing | null> {
  const result = await chrome.storage.session.get(storageKey);
  const candidate = result[storageKey] as Partial<StoredPairing> | undefined;
  if (
    !candidate ||
    typeof candidate.sessionId !== "string" ||
    typeof candidate.playerToken !== "string" ||
    typeof candidate.remoteUrl !== "string" ||
    typeof candidate.pairingPayload !== "string" ||
    typeof candidate.expiresAt !== "string" ||
    Date.parse(candidate.expiresAt) <= Date.now()
  ) {
    await savePairing(null);
    return null;
  }

  return {
    sessionId: candidate.sessionId,
    playerToken: candidate.playerToken,
    remoteUrl: candidate.remoteUrl,
    pairingPayload: candidate.pairingPayload,
    expiresAt: candidate.expiresAt
  };
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function stopPolling(): void {
  if (pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function sendSocketMessage(message: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

async function getActiveSupportedTab(): Promise<ActiveSupportedTab | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) {
      return null;
    }

    const context = getNetflixPageContext(tab.url);
    if (!context.isSupportedSite || !context.site) {
      return null;
    }

    return { tab, tabId: tab.id, site: context.site };
  } catch {
    return null;
  }
}

function unavailableState(site?: SupportedPlayerSite): PlayerState {
  return site ? { ...unavailablePlayerState, platform: site } : { ...unavailablePlayerState };
}

async function sendTabMessage(tabId: number, command: PlayerCommand): Promise<PlayerResponse> {
  let lastError: unknown;

  for (const retryDelay of contentMessageRetryDelaysMs) {
    if (retryDelay > 0) {
      await delay(retryDelay);
    }

    try {
      return await chrome.tabs.sendMessage<PlayerCommand, PlayerResponse>(tabId, command);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("ChromeRemote could not reach the active player tab.");
}

async function readActivePlayerState(): Promise<{ state: PlayerState; activeTabId?: number }> {
  const active = await getActiveSupportedTab();
  if (!active) {
    return { state: unavailableState() };
  }

  try {
    const response = await sendTabMessage(active.tabId, { type: "GET_STATE" });
    if (response.ok) {
      return { state: response.state, activeTabId: active.tabId };
    }

    if (response.state) {
      return { state: response.state, activeTabId: active.tabId };
    }
  } catch {
    // A newly activated Netflix/YouTube tab can take a moment to receive its content script.
    // Keep the phone session connected and report a loading state while retries continue.
  }

  return { state: unavailableState(active.site), activeTabId: active.tabId };
}

async function sendCommandToActiveTab(command: PlayerCommand): Promise<PlayerResponse> {
  if (!storedPairing) {
    return { ok: false, error: "No active phone pairing.", errorCode: "PLAYER_UNAVAILABLE" };
  }

  if (command.type === "GET_STATE") {
    const { state } = await readActivePlayerState();
    return { ok: true, state };
  }

  const active = await getActiveSupportedTab();
  if (!active) {
    return {
      ok: false,
      error: "Switch Chrome to a Netflix or YouTube tab to use the remote.",
      errorCode: "PLAYER_UNAVAILABLE",
      state: unavailableState()
    };
  }

  try {
    return await sendTabMessage(active.tabId, command);
  } catch {
    return {
      ok: false,
      error: `ChromeRemote is waiting for the active ${active.site === "youtube" ? "YouTube" : "Netflix"} tab to finish loading.`,
      errorCode: "PLAYER_UNAVAILABLE",
      state: unavailableState(active.site)
    };
  }
}

async function pushPlayerState(): Promise<void> {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const { state, activeTabId } = await readActivePlayerState();
  sendSocketMessage({ type: "PLAYER_STATE", state });

  if (storedPairing && pairingState.status !== "not-paired" && pairingState.status !== "expired") {
    const nextState = { ...pairingState, activeTabId };
    if (pairingState.activeTabId !== activeTabId) {
      setPairingState(nextState);
    }
  }
}

function startPolling(): void {
  if (pollingTimer !== null) {
    return;
  }

  void pushPlayerState();
  pollingTimer = setInterval(() => {
    void pushPlayerState();
  }, stateIntervalMs) as unknown as number;
}

async function exitViewportFullscreenOnTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage<PlayerCommand, PlayerResponse>(tabId, { type: "EXIT_PLAYER_FULLSCREEN" });
  } catch {
    // The previous tab may have navigated or closed; cleanup is best-effort.
  }
}

async function handleActiveTabChanged(): Promise<void> {
  const active = await getActiveSupportedTab();
  const nextTabId = active?.tabId ?? null;

  if (lastActiveSupportedTabId !== null && lastActiveSupportedTabId !== nextTabId) {
    await exitViewportFullscreenOnTab(lastActiveSupportedTabId);
  }

  lastActiveSupportedTabId = nextTabId;
  await pushPlayerState();
}

chrome.tabs.onActivated.addListener(() => {
  void handleActiveTabChanged();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab.active) {
    return;
  }

  if (changeInfo.url !== undefined || changeInfo.status === "complete") {
    void handleActiveTabChanged();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (lastActiveSupportedTabId === tabId) {
    lastActiveSupportedTabId = null;
    void pushPlayerState();
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    void handleActiveTabChanged();
  }
});

function scheduleReconnect(): void {
  if (!storedPairing || disconnecting || reconnectTimer !== null) {
    return;
  }

  const reconnectDelay = reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)];
  reconnectAttempt += 1;
  setPairingState(sessionState("temporarily-disconnected", storedPairing, pairingState.activeTabId));

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSocket(storedPairing);
  }, reconnectDelay) as unknown as number;
}

function handleServerMessage(message: RemoteServerMessage): void {
  if (!storedPairing) {
    return;
  }

  if (message.type === "AUTH_OK") {
    reconnectAttempt = 0;
    if (pairingState.status !== "connected") {
      setPairingState(sessionState("waiting", storedPairing, pairingState.activeTabId));
    }

    // Start state delivery as soon as the desktop socket authenticates. This removes
    // the controller/player ordering race that could leave Netflix phones spinning on
    // "Connecting" until the phone page was manually refreshed.
    startPolling();
    return;
  }

  if (message.type === "CONTROLLER_CONNECTED") {
    setPairingState(sessionState("connected", storedPairing, pairingState.activeTabId));
    startPolling();
    void pushPlayerState();
    return;
  }

  if (message.type === "CONTROLLER_DISCONNECTED") {
    setPairingState(sessionState("temporarily-disconnected", storedPairing, pairingState.activeTabId));
    stopPolling();
    return;
  }

  if (message.type === "SESSION_EXPIRED") {
    setPairingState({ ...pairingState, status: "expired", error: "Remote session expired" });
    void cleanup(false);
    return;
  }

  if (message.type === "SESSION_ENDED") {
    void cleanup(false);
    return;
  }

  if (message.type === "COMMAND") {
    void sendCommandToActiveTab(message.command).then((response) => {
      const result = response.ok
        ? { type: "COMMAND_RESULT", requestId: message.requestId, ok: true, state: response.state }
        : {
            type: "COMMAND_RESULT",
            requestId: message.requestId,
            ok: false,
            errorCode: toRemoteErrorCode(response.errorCode),
            message: response.error,
            state: response.state
          };

      sendSocketMessage(result);
      if (response.state) {
        sendSocketMessage({ type: "PLAYER_STATE", state: response.state });
      }
    });
  }
}

function connectSocket(pairing: StoredPairing | null): void {
  if (!pairing) {
    return;
  }

  clearReconnectTimer();
  socket?.close();
  socket = new WebSocket(`${REMOTE_WS_ORIGIN}/ws`);

  socket.addEventListener("open", () => {
    sendSocketMessage({
      type: "AUTH",
      role: "player",
      sessionId: pairing.sessionId,
      token: pairing.playerToken
    });
  });

  socket.addEventListener("message", (event) => {
    try {
      handleServerMessage(parseRemoteMessage(String(event.data)) as RemoteServerMessage);
    } catch {
      sendSocketMessage({
        type: "COMMAND_RESULT",
        requestId: "invalid",
        ok: false,
        errorCode: "INVALID_MESSAGE",
        message: "Invalid message."
      });
    }
  });

  socket.addEventListener("close", () => {
    socket = null;
    stopPolling();
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    if (storedPairing) {
      setPairingState({
        ...pairingState,
        status: "temporarily-disconnected",
        errorCode: "WEBSOCKET_CONNECTION_FAILED",
        error: "ChromeRemote could not connect to the relay WebSocket."
      });
    }
    socket?.close();
  });
}

async function cleanup(invalidateServer: boolean): Promise<void> {
  disconnecting = true;
  clearReconnectTimer();
  stopPolling();
  socket?.close();
  socket = null;

  if (lastActiveSupportedTabId !== null) {
    await exitViewportFullscreenOnTab(lastActiveSupportedTabId);
    lastActiveSupportedTabId = null;
  }

  const sessionId = storedPairing?.sessionId;
  await savePairing(null);
  setPairingState({ status: "not-paired" });

  if (invalidateServer && sessionId) {
    fetch(`${REMOTE_HTTP_ORIGIN}/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => undefined);
  }

  disconnecting = false;
}

async function startPairing(): Promise<PairingResponse> {
  if (!isValidRemoteOrigin(REMOTE_HTTP_ORIGIN) || !isValidRemoteOrigin(REMOTE_WS_ORIGIN)) {
    return pairingError("REMOTE_SERVER_NOT_CONFIGURED", "ChromeRemote relay server is not configured.");
  }

  await cleanup(false);
  setPairingState({ status: "creating" });

  try {
    const response = await fetch(`${REMOTE_HTTP_ORIGIN}/api/sessions`, { method: "POST" });
    if (!response.ok) {
      const serverError = await readServerError(response);
      await cleanup(false);
      return pairingError(serverError.errorCode, serverError.error);
    }

    const session = await response.json();
    if (!isCreateRemoteSessionResponse(session)) {
      await cleanup(false);
      return pairingError("SESSION_RESPONSE_INVALID", "ChromeRemote relay returned an invalid session response.");
    }

    const controllerUrlValidation = validateControllerUrl(session.remoteUrl, import.meta.env.PROD);
    if (!controllerUrlValidation.ok) {
      await cleanup(false);
      return pairingError(controllerUrlValidation.errorCode, controllerUrlValidation.error);
    }

    const pairingPayload = encodePairingPayload(session.sessionId, session.controllerToken);
    const nextPairing: StoredPairing = {
      sessionId: session.sessionId,
      playerToken: session.playerToken,
      remoteUrl: session.remoteUrl,
      pairingPayload,
      expiresAt: session.expiresAt
    };

    const active = await getActiveSupportedTab();
    lastActiveSupportedTabId = active?.tabId ?? null;
    await savePairing(nextPairing);
    setPairingState(sessionState("waiting", nextPairing, active?.tabId));
    connectSocket(nextPairing);
    return { ok: true, state: pairingState };
  } catch (error) {
    await cleanup(false);
    const message = error instanceof SyntaxError ? "ChromeRemote relay returned an invalid session response." : "ChromeRemote could not reach the relay server.";
    const errorCode = error instanceof SyntaxError ? "SESSION_RESPONSE_INVALID" : "REMOTE_SERVER_UNREACHABLE";
    setPairingState({ status: "not-paired", errorCode, error: message });
    return pairingError(errorCode, message);
  }
}

async function readServerError(response: Response): Promise<{ errorCode: PairingErrorCode; error: string }> {
  try {
    const body = (await response.json()) as { errorCode?: unknown; message?: unknown };
    if (body.errorCode === "REMOTE_SERVER_NOT_CONFIGURED" && typeof body.message === "string") {
      return { errorCode: "REMOTE_SERVER_NOT_CONFIGURED", error: body.message };
    }
  } catch {
    // Fall through to the generic session creation error below.
  }

  return { errorCode: "SESSION_CREATE_FAILED", error: "ChromeRemote could not create a phone session." };
}

chrome.runtime.onMessage.addListener((message: PairingRequest, _sender, sendResponse: (response: PairingResponse) => void) => {
  if (!isPairingRequest(message)) {
    sendResponse(pairingError("UNSUPPORTED_REMOTE_REQUEST", "Unsupported ChromeRemote pairing request."));
    return false;
  }

  if (message.type === "REMOTE_PING") {
    sendResponse({ ok: true, service: "background" });
    return false;
  }

  if (message.type === "REMOTE_GET_STATUS") {
    sendResponse({ ok: true, state: pairingState });
    return false;
  }

  if (message.type === "REMOTE_CONNECT_PHONE") {
    void startPairing().then(sendResponse);
    return true;
  }

  if (message.type === "REMOTE_DISCONNECT") {
    void cleanup(true).then(() => sendResponse({ ok: true, state: pairingState }));
    return true;
  }

  sendResponse(pairingError("UNSUPPORTED_REMOTE_REQUEST", "Unsupported ChromeRemote pairing request."));
  return false;
});

void loadPairing().then(async (pairing) => {
  if (!pairing) {
    return;
  }

  storedPairing = pairing;
  const active = await getActiveSupportedTab();
  lastActiveSupportedTabId = active?.tabId ?? null;
  setPairingState(sessionState("temporarily-disconnected", pairing, active?.tabId));
  connectSocket(pairing);
});
