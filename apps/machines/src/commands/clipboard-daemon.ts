import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { getClipboardKeyPath, getDataDir } from "../paths.js";
import { readClipboardConfig } from "./clipboard.js";
import { startClipboardServer, getCurrentContentHash, setCurrentContentHash } from "./clipboard-server.js";

const DAEMON_PID_PATH = join(getDataDir(), "clipboard-daemon.pid");

function readLocalClipboardSync(): string {
  const platform = process.platform;
  if (platform === "darwin") {
    const result = Bun.spawnSync(["pbpaste"], { stdout: "pipe", stderr: "pipe" });
    return result.exitCode === 0 ? result.stdout.toString("utf8").trim() : "";
  }
  if (platform === "linux") {
    if (hasCommand("wl-paste")) {
      const result = Bun.spawnSync(["wl-paste"], { stdout: "pipe", stderr: "pipe" });
      return result.exitCode === 0 ? result.stdout.toString("utf8").trim() : "";
    }
    if (hasCommand("xclip")) {
      const result = Bun.spawnSync(["xclip", "-selection", "clipboard", "-o"], { stdout: "pipe", stderr: "pipe" });
      return result.exitCode === 0 ? result.stdout.toString("utf8").trim() : "";
    }
    return "";
  }
  return "";
}

function hasCommand(binary: string): boolean {
  const result = Bun.spawnSync(["bash", "-lc", `command -v ${binary} >/dev/null 2>&1`], { stdout: "ignore", stderr: "ignore", env: process.env });
  return result.exitCode === 0;
}

function hasDisplayServer(): boolean {
  const display = process.env["DISPLAY"] || "";
  const wayland = process.env["WAYLAND_DISPLAY"] || "";
  if (display || wayland) return true;
  // Check for a running GUI compositor/session
  if (process.platform === "darwin") return true; // macOS always has a GUI session
  if (process.platform === "linux") {
    // Check for running wayland/X11 session via loginctl
    try {
      const result = Bun.spawnSync(["loginctl", "list-sessions", "--no-legend"], { stdout: "pipe", stderr: "pipe", env: process.env, timeout: 2000 });
      if (result.exitCode === 0) {
        const sessions = result.stdout.toString("utf8").trim();
        if (sessions) {
          for (const line of sessions.split("\n")) {
            const sessionId = line.trim().split(/\s+/)[0];
            if (sessionId) {
              const typeResult = Bun.spawnSync(["loginctl", "show-session", sessionId, "-p", "Type", "--value"], { stdout: "pipe", stderr: "pipe", env: process.env, timeout: 2000 });
              if (typeResult.exitCode === 0) {
                const sessionType = typeResult.stdout.toString("utf8").trim();
                if (sessionType === "wayland" || sessionType === "x11") {
                  return true;
                }
              }
            }
          }
        }
      }
    } catch {
      // loginctl not available
    }
    return false;
  }
  return false;
}

function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function loadSharedSecret(): string {
  try {
    return readFileSync(getClipboardKeyPath(), "utf8").trim();
  } catch {
    return "";
  }
}

function writePid(pid: number): void {
  writeFileSync(DAEMON_PID_PATH, `${pid}\n`);
}

function readPid(): number | null {
  try {
    const pid = Number.parseInt(readFileSync(DAEMON_PID_PATH, "utf8").trim());
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopClipboardDaemon(): { stopped: boolean; pid: number | null } {
  const pid = readPid();
  if (pid && isProcessRunning(pid)) {
    process.kill(pid, "SIGTERM");
    return { stopped: true, pid };
  }
  return { stopped: false, pid };
}

export function startClipboardDaemon(port?: number): void {
  const config = readClipboardConfig();
  const daemonPort = port || config.port;

  // Start HTTP server
  const { server } = startClipboardServer({ port: daemonPort });
  server.on("listening", () => {
    console.log(`clipboard daemon started on port ${daemonPort} (pid ${process.pid})`);
    writePid(process.pid);
  });

  // Poll local clipboard and push to peers every 500ms
  const secret = loadSharedSecret();
  const machineId = process.env["HASNA_MACHINES_MACHINE_ID"] || "unknown";
  const hasDisplay = hasDisplayServer();

  if (!hasDisplay) {
    console.log("clipboard daemon running in receive-only mode (no display server)");
  }

  setInterval(async () => {
    // Skip polling on headless machines — only receive from peers
    if (!hasDisplay) return;

    const content = readLocalClipboardSync();
    if (!content) return;

    const hash = computeHash(content);
    const currentContentHash = getCurrentContentHash();
    if (hash === currentContentHash) return;

    setCurrentContentHash(hash);

    // Push to all other known machines
    const peers = await discoverPeers();
    for (const peer of peers) {
      try {
        const res = await fetch(`http://${peer.host}:${peer.port}/clipboard`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({
            content,
            contentType: "text",
            sourceMachine: machineId,
          }),
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const data = await res.json() as Record<string, unknown>;
          if (data["received"] === true) {
            console.log(`clipboard sent to ${peer.host}`);
          }
        }
      } catch {
        // peer unreachable
      }
    }
  }, 500);
}

async function discoverPeers(): Promise<{ host: string; port: number }[]> {
  const config = readClipboardConfig();
  const peers: { host: string; port: number }[] = [];

  // Try to discover via tailscale status
  try {
    const result = Bun.spawnSync(["tailscale", "status", "--json"], { stdout: "pipe", stderr: "pipe", env: process.env });
    if (result.exitCode === 0) {
      const status = JSON.parse(result.stdout.toString("utf8")) as Record<string, Record<string, { ID: string; TailscaleIPs: string[] }>>;
      const peers_map = status["Peer"] || {};
      for (const [, peerInfo] of Object.entries(peers_map)) {
        for (const ip of peerInfo.TailscaleIPs) {
          // Only include IPv4
          if (ip.includes(".") && !ip.endsWith(".1")) {
            peers.push({ host: ip, port: config.port });
          }
        }
      }
    }
  } catch {
    // tailscale not available
  }

  const knownPeers = (process.env["HASNA_MACHINES_CLIPBOARD_PEERS"] || "")
    .split(",")
    .map((peer) => peer.trim())
    .filter(Boolean);
  for (const ip of knownPeers) {
    if (!peers.some((p) => p.host === ip)) {
      peers.push({ host: ip, port: config.port });
    }
  }

  return peers;
}
