import type { IncomingMessage } from "node:http";

export const SESSION_CREATION_WINDOW_MS = 60_000;
export const MAX_SESSION_CREATIONS_PER_WINDOW = 8;
export const MAX_TRACKED_RATE_LIMIT_CLIENTS = 4096;

const clientCreationTimestamps = new Map<string, number[]>();

function normalizeClientKey(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "unknown";
  }

  return trimmed.slice(0, 128);
}

export function getClientIp(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[forwarded.length - 1] : forwarded;

  if (typeof forwardedValue === "string") {
    const addresses = forwardedValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const proxyObservedAddress = addresses[addresses.length - 1];
    if (proxyObservedAddress) {
      return normalizeClientKey(proxyObservedAddress);
    }
  }

  return normalizeClientKey(request.socket.remoteAddress);
}

function sweepRateLimitClients(now: number): void {
  for (const [clientKey, timestamps] of clientCreationTimestamps) {
    const recent = timestamps.filter((timestamp) => now - timestamp < SESSION_CREATION_WINDOW_MS);
    if (recent.length === 0) {
      clientCreationTimestamps.delete(clientKey);
    } else if (recent.length !== timestamps.length) {
      clientCreationTimestamps.set(clientKey, recent);
    }
  }
}

export function consumeSessionCreationAttempt(clientKey: string, now = Date.now()): boolean {
  const normalizedKey = normalizeClientKey(clientKey);

  if (clientCreationTimestamps.size >= MAX_TRACKED_RATE_LIMIT_CLIENTS && !clientCreationTimestamps.has(normalizedKey)) {
    sweepRateLimitClients(now);
    if (clientCreationTimestamps.size >= MAX_TRACKED_RATE_LIMIT_CLIENTS) {
      return false;
    }
  }

  const recent = (clientCreationTimestamps.get(normalizedKey) ?? []).filter(
    (timestamp) => now - timestamp < SESSION_CREATION_WINDOW_MS
  );

  if (recent.length >= MAX_SESSION_CREATIONS_PER_WINDOW) {
    clientCreationTimestamps.set(normalizedKey, recent);
    return false;
  }

  recent.push(now);
  clientCreationTimestamps.set(normalizedKey, recent);
  return true;
}

export function safeDecodePathname(rawUrl: string | undefined, baseOrigin: string): string | null {
  try {
    const url = new URL(rawUrl ?? "/", baseOrigin);
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

export function clearSecurityStateForTests(): void {
  clientCreationTimestamps.clear();
}
