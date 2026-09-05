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
import { isRemoteClientMessage, parseRemoteMessage } from "../../src/shared/remote-protocol.js";

type ClientContext = {
  connection: SessionConnection;
  session: RemoteSession | null;
  authenticated: boolean;
  role: "player" | "controller" | null;
};

function writeFrame(socket: Socket, payload: string): void {
  const data = Buffer.from(payload);
  const length = data.length;
  let header: Buffer;

  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  socket.write(Buffer.concat([header, data]));
}

function closeSocket(socket: Socket): void {
  if (!socket.destroyed) {
    socket.end(Buffer.from([0x88, 0x00]));
  }
}

function decodeFrames(buffer: Buffer<ArrayBufferLike>): { messages: string[]; remaining: Buffer<ArrayBufferLike> } {
  const messages: string[] = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;

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
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Frame is too large.");
      }
      length = Number(bigLength);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameEnd = offset + headerLength + maskLength + length;
    if (frameEnd > buffer.length) {
      break;
    }

    if (opcode === 0x8) {
      throw new Error("Socket closed.");
    }

    if (opcode === 0x1) {
      const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
      const payload = Buffer.from(buffer.subarray(offset + headerLength + maskLength, frameEnd));
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }
      messages.push(payload.toString("utf8"));
    }

    offset = frameEnd;
  }

  return { messages, remaining: buffer.subarray(offset) };
}

export function handleUpgrade(request: IncomingMessage, socket: Socket): void {
  if (request.url !== "/ws") {
    socket.destroy();
    return;
  }

  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
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
      "",
      ""
    ].join("\r\n")
  );

  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
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

  socket.on("data", (chunk) => {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeFrames(buffer);
      buffer = decoded.remaining;

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

          context.session = auth.session;
          context.role = message.role;
          context.authenticated = true;
          context.connection.send({ type: "AUTH_OK", role: message.role, expiresAt: new Date(auth.session.expiresAtMs).toISOString() });
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
  });

  socket.on("close", () => removeConnection(context.connection));
  socket.on("error", () => removeConnection(context.connection));
}
