import { REMOTE_HTTP_ORIGIN, REMOTE_WS_ORIGIN } from "../shared/remote-config";
import { getNetflixPageContext } from "../shared/netflix-url";
import type { PlayerCommand, PlayerResponse } from "../shared/messages";
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
  pairedTabId: number;
};

type RestorableWindowState = "normal" | "maximized";

type RemoteFullscreenState = {
  windowId: number;
  previousState: RestorableWindowState;
};

const storageKey = "chromeRemotePairing";
const stateIntervalMs = 1000;
const reconnectDelaysMs = [1000, 2000, 5000, 10000, 30000];

let pairingState: PairingState = { status: "not-paired" };
let storedPairing: StoredPairing | null = null;
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let pollingTimer: number | null = null;
let reconnectAttempt = 0;
let disconnecting = false;
let remoteFullscreenState: RemoteFullscreenState | null = null;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeText({ text: "" });
});

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
  const candidate = result[storageKey] as StoredPairing | undefined;
  if (!candidate || Date.parse(candidate.expiresAt) <= Date.now()) {
    await savePairing(null);
    return null;
  }

  if (!candidate.pairingPayload) {
    await savePairing(null);
    return null;
  }

  return candidate;
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

function scheduleReconnect(): void {
  if (!storedPairing || disconnecting || reconnectTimer !== null) {
    return;
  }

  const delay = reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)];
  reconnectAttempt += 1;
  setPairingState({
    status: "temporarily-disconnected",
    sessionId: storedPairing.sessionId,
    remoteUrl: storedPairing.remoteUrl,
    pairingPayload: storedPairing.pairingPayload,
    expiresAt: storedPairing.expiresAt,
    pairedTabId: storedPairing.pairedTabId
  });

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSocket(storedPairing);
  }, delay) as unknown as number;
}

async function getPairedTabWatchUrl(tabId: number): Promise<string | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return getNetflixPageContext(tab.url).isWatchPage ? (tab.url ?? null) : null;
  } catch {
    return null;
  }
}

async function readPlayerStateFromTab(tabId: number): Promise<PlayerResponse> {
  try {
    return await chrome.tabs.sendMessage<PlayerCommand, PlayerResponse>(tabId, { type: "GET_STATE" });
  } catch {
    return { ok: false, error: "ChromeRemote cannot reach the paired Netflix tab.", errorCode: "PLAYER_UNAVAILABLE" };
  }
}

async function enterRemoteFullscreen(tabId: number): Promise<PlayerResponse> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const chromeWindow = await chrome.windows.get(tab.windowId);

    if (chromeWindow.state !== "fullscreen") {
      const previousState: RestorableWindowState = chromeWindow.state === "maximized" ? "maximized" : "normal";
      remoteFullscreenState = { windowId: tab.windowId, previousState };
      await chrome.windows.update(tab.windowId, { state: "fullscreen", focused: true });
    }

    return await readPlayerStateFromTab(tabId);
  } catch {
    return {
      ok: false,
      error: "ChromeRemote could not enter fullscreen on the paired Chrome window.",
      errorCode: "FULLSCREEN_UNAVAILABLE"
    };
  }
}

async function exitRemoteFullscreen(tabId: number): Promise<PlayerResponse> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const chromeWindow = await chrome.windows.get(tab.windowId);

    if (chromeWindow.state === "fullscreen") {
      const restoreState: RestorableWindowState =
        remoteFullscreenState?.windowId === tab.windowId ? remoteFullscreenState.previousState : "maximized";
      await chrome.windows.update(tab.windowId, { state: restoreState, focused: true });
      remoteFullscreenState = null;
      return await readPlayerStateFromTab(tabId);
    }

    remoteFullscreenState = null;
    return await chrome.tabs.sendMessage<PlayerCommand, PlayerResponse>(tabId, { type: "EXIT_FULLSCREEN" });
  } catch {
    return {
      ok: false,
      error: "ChromeRemote could not exit fullscreen on the paired Chrome window.",
      errorCode: "EXIT_FULLSCREEN_UNAVAILABLE"
    };
  }
}

async function sendCommandToPairedTab(command: PlayerCommand): Promise<PlayerResponse> {
  if (!storedPairing) {
    return { ok: false, error: "No active phone pairing.", errorCode: "PLAYER_UNAVAILABLE" };
  }

  const watchUrl = await getPairedTabWatchUrl(storedPairing.pairedTabId);
  if (!watchUrl) {
    return { ok: false, error: "Netflix is no longer available on the paired tab.", errorCode: "PLAYER_UNAVAILABLE" };
  }

  if (command.type === "FULLSCREEN") {
    return await enterRemoteFullscreen(storedPairing.pairedTabId);
  }

  if (command.type === "EXIT_FULLSCREEN") {
    return await exitRemoteFullscreen(storedPairing.pairedTabId);
  }

  try {
    return await chrome.tabs.sendMessage<PlayerCommand, PlayerResponse>(storedPairing.pairedTabId, command);
  } catch {
    return { ok: false, error: "ChromeRemote cannot reach the paired Netflix tab.", errorCode: "PLAYER_UNAVAILABLE" };
  }
}

async function pushPlayerState(): Promise<void> {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const response = await sendCommandToPairedTab({ type: "GET_STATE" });
  if (response.ok && response.state) {
    socket.send(JSON.stringify({ type: "PLAYER_STATE", state: response.state }));
    return;
  }

  if (!response.ok) {
    socket.send(
      JSON.stringify({
        type: "COMMAND_RESULT",
        requestId: `state-${Date.now()}`,
        ok: false,
        errorCode: "PLAYER_UNAVAILABLE",
        message: response.error
      })
    );
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

function sendSocketMessage(message: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function handleServerMessage(message: RemoteServerMessage): void {
  if (!storedPairing) {
    return;
  }

  if (message.type === "AUTH_OK") {
    reconnectAttempt = 0;
    setPairingState({
      status: "waiting",
      sessionId: storedPairing.sessionId,
      remoteUrl: storedPairing.remoteUrl,
      pairingPayload: storedPairing.pairingPayload,
      expiresAt: storedPairing.expiresAt,
      pairedTabId: storedPairing.pairedTabId
    });
    return;
  }

  if (message.type === "CONTROLLER_CONNECTED") {
    setPairingState({ ...pairingState, status: "connected" });
    startPolling();
    return;
  }

  if (message.type === "CONTROLLER_DISCONNECTED") {
    setPairingState({ ...pairingState, status: "temporarily-disconnected" });
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
    void sendCommandToPairedTab(message.command).then((response) => {
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
  remoteFullscreenState = null;

  const sessionId = storedPairing?.sessionId;
  await savePairing(null);
  setPairingState({ status: "not-paired" });

  if (invalidateServer && sessionId) {
    fetch(`${REMOTE_HTTP_ORIGIN}/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => undefined);
  }

  disconnecting = false;
}

async function startPairing(tabId: number, tabUrl: string): Promise<PairingResponse> {
  if (!getNetflixPageContext(tabUrl).isWatchPage) {
    return pairingError("NOT_NETFLIX_WATCH_PAGE", "Open a Netflix movie or episode before connecting a phone.");
  }

  if (!isValidRemoteOrigin(REMOTE_HTTP_ORIGIN) || !isValidRemoteOrigin(REMOTE_WS_ORIGIN)) {
    return pairingError("REMOTE_SERVER_NOT_CONFIGURED", "ChromeRemote relay server is not configured.");
  }

  await cleanup(false);
  setPairingState({ status: "creating", pairedTabId: tabId });

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
      expiresAt: session.expiresAt,
      pairedTabId: tabId
    };

    await savePairing(nextPairing);
    setPairingState({
      status: "waiting",
      sessionId: session.sessionId,
      remoteUrl: session.remoteUrl,
      pairingPayload,
      expiresAt: session.expiresAt,
      pairedTabId: tabId
    });
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
    void startPairing(message.tabId, message.tabUrl).then(sendResponse);
    return true;
  }

  if (message.type === "REMOTE_DISCONNECT") {
    void cleanup(true).then(() => sendResponse({ ok: true, state: pairingState }));
    return true;
  }

  sendResponse(pairingError("UNSUPPORTED_REMOTE_REQUEST", "Unsupported ChromeRemote pairing request."));
  return false;
});

void loadPairing().then((pairing) => {
  if (!pairing) {
    return;
  }

  storedPairing = pairing;
  setPairingState({
    status: "temporarily-disconnected",
    sessionId: pairing.sessionId,
    remoteUrl: pairing.remoteUrl,
    pairingPayload: pairing.pairingPayload,
    expiresAt: pairing.expiresAt,
    pairedTabId: pairing.pairedTabId
  });
  connectSocket(pairing);
});
