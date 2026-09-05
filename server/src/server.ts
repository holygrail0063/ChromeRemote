import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, invalidateSession } from "./sessions.js";
import { handleUpgrade } from "./websocket.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const developmentPublicOrigin = "http://localhost:8787";
const publicOrigin = (process.env.PUBLIC_ORIGIN ?? developmentPublicOrigin).replace(/\/$/, "");
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
    return process.env.PUBLIC_ORIGIN;
  }

  if (isProductionRuntime()) {
    throw new Error("PUBLIC_ORIGIN is required in production.");
  }

  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = typeof forwardedProto === "string" ? forwardedProto.split(",")[0].trim() : "http";
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  const hostname = Array.isArray(host) ? host[0] : host;

  return hostname ? `${proto}://${hostname}` : publicOrigin;
}

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID)
  );
}

function baseHeaders(request: import("node:http").IncomingMessage): Record<string, string> {
  const corsOrigin = getCorsOrigin(request);

  return {
    ...(corsOrigin ? { "access-control-allow-origin": corsOrigin, vary: "Origin" } : {}),
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function sendJson(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    ...baseHeaders(request),
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function sendConfigError(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): void {
  sendJson(request, response, 500, {
    ok: false,
    errorCode: "REMOTE_SERVER_NOT_CONFIGURED",
    message: "ChromeRemote remote server is not configured for phone access."
  });
}

async function getStaticRoot(): Promise<string | null> {
  for (const candidate of staticCandidates) {
    try {
      if ((await stat(candidate)).isDirectory()) {
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
  const filePath = normalize(join(staticRoot, routePath));

  if (!filePath.startsWith(staticRoot)) {
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

async function serveSpaApp(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const requestUrl = new URL(request.url ?? "/", publicOrigin);
  const pathname = decodeURIComponent(requestUrl.pathname);
  if (!spaRoutes.has(pathname) && !pathname.startsWith("/r/")) {
    return false;
  }

  const staticRoot = await getStaticRoot();
  return staticRoot ? serveStaticFile(request, response, staticRoot, "index.html") : false;
}

async function serveStatic(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const staticRoot = await getStaticRoot();
  if (!staticRoot) {
    return false;
  }

  const requestUrl = new URL(request.url ?? "/", publicOrigin);
  const pathname = decodeURIComponent(requestUrl.pathname);
  return serveStaticFile(request, response, staticRoot, pathname);
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

async function handleRequest(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): Promise<void> {
  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, {});
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(request, response, 200, { ok: true, service: "chromeremote" });
    return;
  }

  if (request.method === "POST" && request.url === "/api/sessions") {
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
    } catch {
      sendConfigError(request, response);
    }
    return;
  }

  const deleteMatch = request.url?.match(/^\/api\/sessions\/([^/]+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    sendJson(request, response, invalidateSession(decodeURIComponent(deleteMatch[1])) ? 200 : 404, { ok: true });
    return;
  }

  if (request.url?.startsWith("/api/")) {
    sendJson(request, response, 404, { ok: false });
    return;
  }

  if (await serveSpaApp(request, response)) {
    return;
  }

  if (await serveStatic(request, response)) {
    return;
  }

  sendJson(request, response, 404, { ok: false });
}

server.on("upgrade", handleUpgrade);

server.listen(port, host, () => {
  console.log(`ChromeRemote relay listening on ${host}:${port}`);
});
