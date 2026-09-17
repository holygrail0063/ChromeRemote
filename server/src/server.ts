import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSession,
  getActiveSessionCount,
  MAX_ACTIVE_SESSIONS,
  sweepExpiredSessions
} from "./sessions.js";
import {
  consumeSessionCreationAttempt,
  getClientIp,
  safeDecodePathname
} from "./security.js";
import { handleUpgrade } from "./websocket.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const developmentPublicOrigin = "http://localhost:8787";
const productionPublicOrigin = "https://chromeremote-production.up.railway.app";

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID)
  );
}

const publicOrigin = (process.env.PUBLIC_ORIGIN ?? (isProductionRuntime() ? productionPublicOrigin : developmentPublicOrigin)).replace(/\/$/, "");
const webSocketOrigin = publicOrigin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? publicOrigin)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const serverSourceDir = dirname(fileURLToPath(import.meta.url));
const staticCandidates = [
  resolve(process.cwd(), "remote", "dist"),
  resolve(serverSourceDir, "../../../..", "remote", "dist")
];
const spaRoutes = new Set(["/", "/remote_session"]);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function getCorsOrigin(request: import("node:http").IncomingMessage): string | undefined {
  const origin = request.headers.origin;
  if (typeof origin !== "string") {
    return undefined;
  }

  if (origin.startsWith("chrome-extension://") || allowedOrigins.includes(origin)) {
    return origin;
  }

  return undefined;
}

function getRequestPublicOrigin(request: import("node:http").IncomingMessage): string {
  if (process.env.PUBLIC_ORIGIN) {
    return process.env.PUBLIC_ORIGIN.replace(/\/$/, "");
  }

  if (isProductionRuntime()) {
    return productionPublicOrigin;
  }

  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = typeof forwardedProto === "string" ? forwardedProto.split(",")[0].trim() : "http";
  const forwardedHost = request.headers["x-forwarded-host"] ?? request.headers.host;
  const requestHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;

  return requestHost ? `${proto}://${requestHost}` : publicOrigin;
}

function baseHeaders(request: import("node:http").IncomingMessage): Record<string, string> {
  const corsOrigin = getCorsOrigin(request);
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src 'self' ${webSocketOrigin}`
  ].join("; ");

  return {
    ...(corsOrigin ? { "access-control-allow-origin": corsOrigin, vary: "Origin" } : {}),
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-security-policy": contentSecurityPolicy,
    "permissions-policy": "camera=(self), microphone=(), geolocation=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...(isProductionRuntime() ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {})
  };
}

function sendJson(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  statusCode: number,
  body: unknown
): void {
  response.writeHead(statusCode, {
    ...baseHeaders(request),
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function hasUnexpectedRequestBody(request: import("node:http").IncomingMessage): boolean {
  if (request.headers["transfer-encoding"] !== undefined) {
    return true;
  }

  const contentLength = request.headers["content-length"];
  if (typeof contentLength !== "string") {
    return false;
  }

  const parsedLength = Number(contentLength);
  return !Number.isFinite(parsedLength) || parsedLength > 0;
}

async function getStaticRoot(): Promise<string | null> {
  for (const candidate of staticCandidates) {
    try {
      const indexPath = resolve(candidate, "index.html");
      if ((await stat(candidate)).isDirectory() && (await stat(indexPath)).isFile()) {
        return candidate;
      }
    } catch {
      // Try the next production/development candidate.
    }
  }

  return null;
}

async function serveStaticFile(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  staticRoot: string,
  routePath: string
): Promise<boolean> {
  const relativePath = routePath.replace(/^\/+/, "");
  const filePath = resolve(staticRoot, relativePath);
  const relativeToRoot = relative(staticRoot, filePath);

  if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) {
    sendJson(request, response, 403, { ok: false });
    return true;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return false;
    }

    response.writeHead(200, {
      ...baseHeaders(request),
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
      "content-length": fileStat.size
    });

    if (request.method === "HEAD") {
      response.end();
      return true;
    }

    createReadStream(filePath).pipe(response);
    return true;
  } catch {
    return false;
  }
}

async function serveSpaApp(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  pathname: string
): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  if (!spaRoutes.has(pathname) && !pathname.startsWith("/r/")) {
    return false;
  }

  const staticRoot = await getStaticRoot();
  return staticRoot ? serveStaticFile(request, response, staticRoot, "index.html") : false;
}

async function serveStatic(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  pathname: string
): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const staticRoot = await getStaticRoot();
  return staticRoot ? serveStaticFile(request, response, staticRoot, pathname) : false;
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error("Unhandled ChromeRemote HTTP request error:", error instanceof Error ? error.message : "unknown error");
    if (!response.headersSent) {
      try {
        sendJson(request, response, 500, { ok: false });
      } catch {
        response.destroy();
      }
    } else {
      response.destroy();
    }
  });
});

async function handleRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse
): Promise<void> {
  if (request.method === "OPTIONS") {
    response.writeHead(204, baseHeaders(request));
    response.end();
    return;
  }

  const pathname = safeDecodePathname(request.url, publicOrigin);
  if (pathname === null) {
    sendJson(request, response, 400, { ok: false });
    return;
  }

  if (request.method === "GET" && pathname === "/health") {
    sendJson(request, response, 200, { ok: true, service: "chromeremote" });
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions") {
    if (hasUnexpectedRequestBody(request)) {
      sendJson(request, response, 413, { ok: false, errorCode: "INVALID_REQUEST", message: "Request body is not allowed." });
      return;
    }

    if (!consumeSessionCreationAttempt(getClientIp(request))) {
      sendJson(request, response, 429, { ok: false, errorCode: "RATE_LIMITED", message: "Too many pairing attempts." });
      return;
    }

    sweepExpiredSessions();
    if (getActiveSessionCount() >= MAX_ACTIVE_SESSIONS) {
      sendJson(request, response, 503, { ok: false, errorCode: "SESSION_CAPACITY_REACHED", message: "ChromeRemote is temporarily at capacity." });
      return;
    }

    try {
      const productionRuntime = isProductionRuntime();
      sendJson(
        request,
        response,
        201,
        createSession(Date.now(), getRequestPublicOrigin(request), {
          allowLocalOrigins: !productionRuntime,
          requireHttps: productionRuntime
        })
      );
    } catch (error) {
      console.error("Failed to create ChromeRemote session:", error instanceof Error ? error.message : "unknown error");
      sendJson(request, response, 500, {
        ok: false,
        errorCode: "SESSION_CREATE_FAILED",
        message: "ChromeRemote could not create a phone session."
      });
    }
    return;
  }

  // Session invalidation is intentionally performed by an authenticated controller
  // over the WebSocket END_SESSION command. Do not expose session-id-only deletion.
  if (pathname.startsWith("/api/")) {
    sendJson(request, response, 404, { ok: false });
    return;
  }

  if (await serveSpaApp(request, response, pathname)) {
    return;
  }

  if (await serveStatic(request, response, pathname)) {
    return;
  }

  sendJson(request, response, 404, { ok: false });
}

server.on("upgrade", handleUpgrade);
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;
server.maxConnections = 500;

const sessionSweepTimer = setInterval(() => {
  sweepExpiredSessions();
}, 60_000);
sessionSweepTimer.unref();

const startupStaticRoot = await getStaticRoot();
if (!startupStaticRoot) {
  console.error("ChromeRemote mobile app build is missing. Run npm run build:railway before starting the server.");
  process.exit(1);
}

server.listen(port, host, () => {
  console.log(`ChromeRemote relay listening on ${host}:${port}`);
  console.log(`ChromeRemote mobile app served from ${startupStaticRoot}`);
  console.log(`ChromeRemote public origin: ${publicOrigin}`);
});
