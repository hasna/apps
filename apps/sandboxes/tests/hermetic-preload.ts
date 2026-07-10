import childProcess from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";

const denied = (surface: string): never => {
  throw new Error(`hermetic isolation denied ${surface}`);
};

globalThis.fetch = (async () => denied("network fetch")) as unknown as typeof fetch;

Object.defineProperty(Bun, "spawn", {
  configurable: false,
  writable: false,
  value: () => denied("subprocess spawn"),
});
Object.defineProperty(Bun, "spawnSync", {
  configurable: false,
  writable: false,
  value: () => denied("subprocess spawnSync"),
});
Object.defineProperty(Bun, "connect", {
  configurable: false,
  writable: false,
  value: () => denied("socket connect"),
});
Object.defineProperty(Bun, "udpSocket", {
  configurable: false,
  writable: false,
  value: () => denied("UDP socket"),
});

for (const method of ["exec", "execFile", "fork", "spawn", "execSync", "execFileSync", "spawnSync"] as const) {
  Object.defineProperty(childProcess, method, {
    configurable: false,
    writable: false,
    value: () => denied(`child_process.${method}`),
  });
}
for (const method of ["connect", "createConnection"] as const) {
  Object.defineProperty(net, method, {
    configurable: false,
    writable: false,
    value: () => denied(`net.${method}`),
  });
}
Object.defineProperty(tls, "connect", {
  configurable: false,
  writable: false,
  value: () => denied("tls.connect"),
});
Object.defineProperty(dgram, "createSocket", {
  configurable: false,
  writable: false,
  value: () => denied("dgram.createSocket"),
});
for (const method of ["lookup", "resolve", "resolve4", "resolve6"] as const) {
  Object.defineProperty(dns, method, {
    configurable: false,
    writable: false,
    value: () => denied(`dns.${method}`),
  });
}

process.env = {
  HOME: "/nonexistent",
  PATH: "/runtime",
  TMPDIR: "/tmp",
};
