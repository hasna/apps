import { describe, it, expect, mock, afterEach } from "bun:test";
import { createServer, type AddressInfo, type Server, type Socket } from "net";

// Stub DNS so the MX lookup resolves to a local endpoint without network access.
mock.module("dns/promises", () => ({
  resolve: async () => [{ exchange: "127.0.0.1", priority: 10 }],
}));

const { verifyEmailAddress } = await import("./email-verify.js");

const servers: Server[] = [];
const acceptedSockets: Socket[] = [];

afterEach(() => {
  for (const sock of acceptedSockets.splice(0)) sock.destroy();
  for (const server of servers.splice(0)) server.close();
});

/**
 * Accepts the TCP connection and then stalls the SMTP state machine: no banner
 * (or an unparseable one), never advancing past "connect".
 */
async function startStallServer(opts: { sendGarbageBanner?: boolean } = {}): Promise<{ accepted: Socket[]; port: number }> {
  const accepted: Socket[] = [];
  const server = createServer((sock) => {
    accepted.push(sock);
    acceptedSockets.push(sock);
    if (opts.sendGarbageBanner) {
      sock.write("XYZ we are not an SMTP server\r\n");
    }
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return { accepted, port };
}

/** Resolves true when the socket reaches 'close' within the window, false otherwise. */
function waitForClose(sock: Socket, windowMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (sock.destroyed) return resolve(true);
    const timer = setTimeout(() => {
      sock.removeAllListeners("close");
      resolve(false);
    }, windowMs);
    sock.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

describe("verifyEmailAddress SMTP probe socket lifecycle", () => {
  it("destroys the probe socket when the SMTP probe times out on a stalling host", async () => {
    const { accepted, port } = await startStallServer();

    const result = await verifyEmailAddress("someone@stall.test", {
      smtpProbe: true,
      timeoutMs: 150,
      smtpProbePort: port,
    });

    // Caller contract unchanged: a skipped probe still reports valid via MX.
    expect(result.valid).toBe(true);
    expect(result.reason).toBe("MX valid, SMTP probe skipped");

    expect(accepted.length).toBe(1);
    // The client must have destroyed its side of the accepted connection.
    const closed = await waitForClose(accepted[0]!, 1500);
    expect(closed).toBe(true);
  });

  it("destroys the probe socket when the banner is not a valid SMTP code", async () => {
    const { accepted, port } = await startStallServer({ sendGarbageBanner: true });

    const result = await verifyEmailAddress("someone@stall.test", {
      smtpProbe: true,
      timeoutMs: 150,
      smtpProbePort: port,
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBe("MX valid, SMTP probe skipped");

    expect(accepted.length).toBe(1);
    const closed = await waitForClose(accepted[0]!, 1500);
    expect(closed).toBe(true);
  });
});
