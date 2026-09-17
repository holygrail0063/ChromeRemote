import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import {
  authenticate,
  forwardFromController,
  forwardFromPlayer,
  invalidateSession,
  removeConnection,
  type RemoteSession,
  type SessionConnection
} from "./sessions.js";
import { getClientIp } from "./security.js";
import {
  isRemoteClientMessage,
  MAX_REMOTE_MESSAGE_BYTES,
  parseRemoteMessage
} from "../../src/shared/remote-protocol.js";

type ClientContext = {
  connection: SessionConnection;
  session: RemoteSession | null;
  authenticated: boolean;
  role: "player" | "controller" | null;
};

type DecodedFrames = {
  messages: string[];
  pings: Buffer[];
  remaining: Buffer<ArrayBufferLike>;
};

const MAX_SOCKET_BUFFER_BYTES = 64 * 1024;
const MAX_FRAMES_PER_READ = 64;
const MAX_TOTAL_WEBSOCKET_CONNECTIONS = 200;
const MAX_WEBSOCKET_CONNECTIONS_PER_CLIENT = 20;
const AUTH_TIMEOUT_MS = 5000;

let activeWebSocketConnections = 0;
const activeConnectionsByClient = new Map<string, number>();

function configuredAllowedOrigins(): string[] {
  const publicOrigin = (process.env.PUBLIC_ORIGIN ?? "http://localhost:8787").replace(/\/$/, "");
  return (process.env.ALLOWED_ORIGINS ?? publicOrigin)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isAllowedWebSocketOrigin(origin: string | undefined, allowedOrigins = configuredAllowedOrigins()): boolean {
  // Browsers send Origin. Allowing a missing Origin keeps non-browser/local development
  // clients compatible, while still blocking cross-site browser WebSocket attempts.
  if (!origin) {
    return true;
  }

  return origin.startsWith("chrome-extension://") || allowedOrigins.includes(origin);
}

function headerIncludesToken(value: string | string[] | undefined, expected: string): boolean {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  return raw
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .includes(expected.toLowerCase());
}

function isValidWebSocketKey(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  try {
    return Buffer.from(value, "base64").length === 16;
  } catch {
    return false;
  }
}

function writeServerFrame(socket: Socket, opcode: number, payload: Buffer): void {
  const length = payload.length;
  let header: Buffer;

  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

function writeFrame(socket: Socket, payload: string): void {
  writeServerFrame(socket, 0x1, Buffer.from(payload));
}

function closeSocket(socket: Socket): void {
  if (socket.destroyed) {
    return;
  }

  try {
    writeServerFrame(socket, 0x8, Buffer.alloc(0));
    socket.end();
  } catch {
    socket.destroy();
  }
}

function rejectUpgrade(socket: Socket, statusCode: number, statusText: string): void {
  if (socket.destroyed) {
    return;
  }

  socket.end(
    [
      `HTTP/1.1 ${statusCode} ${statusText}`,
      "Connection: close",
      "Content-Length: 0",
      "Cache-Control: no-store",
      "",
      ""
    ].join("\r\n")
  );
}

function reserveConnection(clientKey: string): boolean {
  const clientConnections = activeConnectionsByClient.get(clientKey) ?? 0;
  if (
    activeWebSocketConnections >= MAX_TOTAL_WEBSOCKET_CONNECTIONS ||
    clientConnections >= MAX_WEBSOCKET_CONNECTIONS_PER_CLIENT
  ) {
    return false;
  }

  activeWebSocketConnections += 1;
  activeConnectionsByClient.set(clientKey, clientConnections + 1);
  return true;
}

function releaseConnection(clientKey: string): void {
  activeWebSocketConnections = Math.max(0, activeWebSocketConnections - 1);
  const nextClientConnections = Math.max(0, (activeConnectionsByClient.get(clientKey) ?? 1) - 1);
  if (nextClientConnections === 0) {
    activeConnectionsByClient.delete(clientKey);
  } else {
    activeConnectionsByClient.set(clientKey, nextClientConnections);
  }
}

export function decodeFrames(buffer: Buffer<ArrayBufferLike>): DecodedFrames {
  const messages: string[] = [];
  const pings: Buffer[] = [];
  let offset = 0;
  let frameCount = 0;

  while (offset + 2 <= buffer.length) {
    frameCount += 1;
    if (frameCount > MAX_FRAMES_PER_READ) {
      throw new Error("Too many WebSocket frames in one read.");
    }

    const first = buffer[offset];
    const second = buffer[offset + 1];
    const finished = Boolean(first & 0x80);
    const reservedBits = first & 0x70;
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;

    if (!finished || reservedBits !== 0) {
      throw new Error("Unsupported WebSocket frame.");
    }

    if (!masked) {
      throw new Error("Client WebSocket frames must be masked.");
    }

    if (length === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }
      const bigLength = buffer.readBigUInt64BE(offset + 2);
      if (bigLength > BigInt(MAX_REMOTE_MESSAGE_BYTES)) {
        throw new Error("WebSocket frame is too large.");
      }
      length = Number(bigLength);
      headerLength = 10;
    }

    if (length > MAX_REMOTE_MESSAGE_BYTES) {
      throw new Error("WebSocket frame is too large.");
    }

    if ((opcode === 0x8 || opcode === 0x9 || opcode === 0xa) && length > 125) {
      throw new Error("Invalid WebSocket control frame.");
    }

    const maskLength = 4;
    const frameEnd = offset + headerLength + maskLength + length;
    if (frameEnd > buffer.length) {
      break;
    }

    const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
    const payload = Buffer.from(buffer.subarray(offset + headerLength + maskLength, frameEnd));
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }

    if (opcode === 0x8) {
      throw new Error("Socket closed.");
    }

    if (opcode === 0x1) {
      messages.push(payload.toString("utf8"));
    } else if (opcode === 0x9) {
      pings.push(payload);
    } else if (opcode !== 0xa) {
      throw new Error("Unsupported WebSocket opcode.");
    }

    offset = frameEnd;
  }

  return { messages, pings, remaining: buffer.subarray(offset) };
}

export function handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer = Buffer.alloc(0)): void {
  if (request.url !== "/ws") {
    rejectUpgrade(socket, 404, "Not Found");
    return;
  }

  if (
    request.method !== "GET" ||
    !headerIncludesToken(request.headers.upgrade, "websocket") ||
    !headerIncludesToken(request.headers.connection, "upgrade") ||
    request.headers["sec-websocket-version"] !== "13" ||
    !isAllowedWebSocketOrigin(typeof request.headers.origin === "string" ? request.headers.origin : undefined)
  ) {
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }

  const keyHeader = request.headers["sec-websocket-key"];
  const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
  if (!isValidWebSocketKey(key)) {
    rejectUpgrade(socket, 400, "Bad Request");
    return;
  }

  const clientKey = getClientIp(request);
  if (!reserveConnection(clientKey)) {
    rejectUpgrade(socket, 429, "Too Many Requests");
    return;
  }

  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "Cache-Control: no-store",
      "",
      ""
    ].join("\r\n")
  );

  socket.setNoDelay(true);

  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let released = false;
  const context: ClientContext = {
    authenticated: false,
    role: null,
    session: null,
    connection: {
      id: randomUUID(),
      role: "controller",
      send(message: unknown) {
        writeFrame(socket, JSON.stringify(message));
      },
      close() {
        closeSocket(socket);
      }
    }
  };

  const release = () => {
    if (released) {
      return;
    }
    released = true;
    releaseConnection(clientKey);
    if (context.authenticated) {
      removeConnection(context.connection);
    }
  };

  const authTimer = setTimeout(() => {
    if (!context.authenticated) {
      closeSocket(socket);
    }
  }, AUTH_TIMEOUT_MS);
  authTimer.unref();

  const onData = (chunk: Buffer) => {
    try {
      if (chunk.length > MAX_SOCKET_BUFFER_BYTES || buffer.length + chunk.length > MAX_SOCKET_BUFFER_BYTES) {
        throw new Error("WebSocket buffer limit exceeded.");
      }

      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeFrames(buffer);
      buffer = decoded.remaining;

      for (const ping of decoded.pings) {
        writeServerFrame(socket, 0xa, ping);
      }

      for (const raw of decoded.messages) {
        const message = parseRemoteMessage(raw);
        if (!isRemoteClientMessage(message)) {
          context.connection.send({ type: "AUTH_FAILED", errorCode: "INVALID_MESSAGE", message: "Invalid message." });
          continue;
        }

        if (!context.authenticated) {
          if (message.type !== "AUTH") {
            context.connection.send({ type: "AUTH_FAILED", errorCode: "UNAUTHENTICATED", message: "Authenticate before sending commands." });
            closeSocket(socket);
            return;
          }

          context.connection.role = message.role;
          const auth = authenticate(message.sessionId, message.role, message.token, context.connection);
          if (!auth.ok) {
            context.connection.send({ type: "AUTH_FAILED", errorCode: auth.errorCode, message: auth.message });
            closeSocket(socket);
            return;
          }

          clearTimeout(authTimer);
          context.session = auth.session;
          context.role = message.role;
          context.authenticated = true;
          context.connection.send({ type: "AUTH_OK", role: message.role, expiresAt: new Date(auth.session.expiresAtMs).toISOString() });

          if (message.role === "player" && auth.session.controller) {
            context.connection.send({ type: "CONTROLLER_CONNECTED" });
          }

          continue;
        }

        if (!context.session) {
          continue;
        }

        if (message.type === "PING") {
          context.connection.send({ type: "PONG" });
        } else if (context.role === "controller" && message.type === "END_SESSION") {
          invalidateSession(context.session.sessionId);
          return;
        } else if (context.role === "controller" && message.type === "COMMAND") {
          const forwarded = forwardFromController(context.session, message);
          if (!forwarded.ok) {
            context.connection.send({
              type: "COMMAND_RESULT",
              requestId: message.requestId,
              ok: false,
              errorCode: forwarded.errorCode,
              message: forwarded.message
            });
          }
        } else if (context.role === "player") {
          forwardFromPlayer(context.session, message);
        }
      }
    } catch {
      closeSocket(socket);
    }
  };

  socket.on("data", onData);
  socket.once("close", () => {
    clearTimeout(authTimer);
    release();
  });
  socket.once("error", () => {
    clearTimeout(authTimer);
    release();
  });

  if (head.length > 0) {
    onData(head);
  }
}
