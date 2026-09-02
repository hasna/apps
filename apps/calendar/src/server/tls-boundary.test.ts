import { expect, test } from "bun:test";
import { createServer, connect, type Socket, type Server } from "node:net";
import { createServer as createTlsServer } from "node:tls";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}
function pgError(message: string) {
  const body = Buffer.from("SFATAL\0C28000\0M" + message + "\0\0");
  const length = Buffer.alloc(4); length.writeInt32BE(body.length + 4);
  return Buffer.concat([Buffer.from("E"), length, body]);
}
// Real Bun driver, real loopback TLS negotiation; no database or user credentials.
test("review P1: real Bun verifies certificates and never downgrades to plaintext", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calendar-tls-fixture-"));
  const sockets = new Set<Socket>();
  const servers: Server[] = [];
  const track = (socket: Socket) => { sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket)); };
  let startupMessages = 0;
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
    const tlsServer = createTlsServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, socket => {
      track(socket); socket.once("data", () => { startupMessages++; socket.end(pgError("CALENDAR_TLS_ESTABLISHED")); });
    });
    servers.push(tlsServer);
    let tlsPort = await listen(tlsServer);
    const front = createServer(socket => {
      track(socket);
      socket.once("data", chunk => {
        // Hold the immediate TLS ClientHello until the upstream is attached.
        socket.pause();
        const negotiation = chunk.length === 8 && chunk.readInt32BE(4) === 80877103;
        const directTls = chunk[0] === 22;
        if (!negotiation && !directTls) { socket.destroy(); return; }
        if (negotiation) socket.write("S");
        const upstream = connect(tlsPort, "127.0.0.1", () => { if (directTls) upstream.write(chunk); socket.pipe(upstream); upstream.pipe(socket); socket.resume(); }); track(upstream);
      });
    });
    servers.push(front); const port = await listen(front);
    async function probe(port: number, trusted: boolean, certificate = "cert.pem") {
      const env = { PATH: process.env.PATH!, HOME: dir, NODE_TLS_REJECT_UNAUTHORIZED: "0", PGSSLMODE: "disable", CALENDAR_TLS_FIXTURE_URL: `postgres://fixture@127.0.0.1:${port}/fixture?sslmode=verify-full`, ...(trusted ? { NODE_EXTRA_CA_CERTS: join(dir, certificate) } : {}) };
      const code = `import { createCalendarCloudQueryClient } from "./src/server/cloud-client.ts";
const client = createCalendarCloudQueryClient(process.env.CALENDAR_TLS_FIXTURE_URL!, { max: 1, connectionTimeout: 2, ca: process.env.NODE_EXTRA_CA_CERTS ? await Bun.file(process.env.NODE_EXTRA_CA_CERTS).text() : undefined });
try { await client.query("select 1"); process.stdout.write("UNEXPECTED_SUCCESS"); } catch(e) { process.stdout.write(String((e as Error).message)); } finally { await client.close(); }`;
      const proc = Bun.spawn([process.execPath, "-e", code], { cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe" });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      return output;
    }
    const untrusted = await probe(port, false);
    expect(untrusted).not.toContain("CALENDAR_TLS_ESTABLISHED");
    // Bun 1.3.14 retries failed TLS sockets until connectionTimeout rather
    // than consistently exposing a certificate-specific final error.
    expect(untrusted).not.toContain("UNEXPECTED_SUCCESS");
    expect(startupMessages).toBe(0);
    const trusted = await probe(port, true);
    expect(trusted).toContain("CALENDAR_TLS_ESTABLISHED");
    expect(startupMessages).toBe(1);
    execFileSync("openssl", ["req", "-x509", "-key", join(dir, "key.pem"), "-out", join(dir, "wrong.pem"), "-days", "1", "-subj", "/CN=wrong.example.test", "-addext", "subjectAltName=DNS:wrong.example.test"], { stdio: "ignore" });
    const wrongServer = createTlsServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "wrong.pem")) }, socket => {
      track(socket); socket.once("data", () => { startupMessages++; socket.end(pgError("CALENDAR_TLS_ESTABLISHED")); });
    });
    servers.push(wrongServer); tlsPort = await listen(wrongServer);
    const wrongHostname = await probe(port, true, "wrong.pem");
    expect(wrongHostname).not.toContain("CALENDAR_TLS_ESTABLISHED");
    expect(startupMessages).toBe(1);
    let plaintextMessages = 0;
    const plain = createServer(socket => { track(socket); socket.once("data", () => { socket.write("N"); socket.on("data", () => { plaintextMessages++; socket.destroy(); }); }); });
    servers.push(plain); const plainPort = await listen(plain);
    const denied = await probe(plainPort, true);
    expect(denied).not.toContain("UNEXPECTED_SUCCESS");
    expect(plaintextMessages).toBe(0);
  } finally {
    for (const socket of sockets) socket.destroy();
    for (const server of servers) await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
