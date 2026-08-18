#!/usr/bin/env bun
/**
 * monitor-daemon — the monitor v2 execution daemon.
 *
 * Control-plane verbs (`run`, `status`, `pause`, `resume`, `drain`, `stop`,
 * `recover`, `replace`) operate on the durable daemon_state row. `run` is
 * the bounded real-clock loop: admission, heartbeat, sweep, and backfill on
 * an interval. The `monitor daemon *` CLI verbs (MON-V2-05) compose the same
 * Daemon class.
 */

import { Database } from "bun:sqlite";
import { SystemClock } from "../src/daemon/clock.js";
import { ensureV2Schema } from "../src/daemon/schema.js";
import { Daemon } from "../src/daemon/daemon.js";
import { ShellCheckExecutor } from "../src/daemon/shell-executor.js";

interface Options {
  dbPath: string;
  daemonId: string;
  intervalMs: number;
  capacity: number;
  leaseTtlMs: number;
  sweepIntervalMs: number;
  stopBoundMs: number;
}

function parseArgs(argv: string[]): { verb: string; opts: Options } {
  const args = argv.slice(2);
  const verb = args[0] ?? "run";
  const opts: Options = {
    dbPath: process.env["HASNA_MONITOR_DB_PATH"] ?? `${process.env["HOME"]}/.hasna/monitor/monitor.db`,
    daemonId: process.env["HASNA_MONITOR_DAEMON_ID"] ?? "local-1",
    intervalMs: 5_000,
    capacity: 4,
    leaseTtlMs: 60_000,
    sweepIntervalMs: 60_000,
    stopBoundMs: 30_000,
  };
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (value === undefined) continue;
    switch (key) {
      case "--db-path":
        opts.dbPath = value;
        break;
      case "--daemon-id":
        opts.daemonId = value;
        break;
      case "--interval-ms":
        opts.intervalMs = Number(value);
        break;
      case "--capacity":
        opts.capacity = Number(value);
        break;
      case "--lease-ttl-ms":
        opts.leaseTtlMs = Number(value);
        break;
      case "--sweep-interval-ms":
        opts.sweepIntervalMs = Number(value);
        break;
      case "--stop-bound-ms":
        opts.stopBoundMs = Number(value);
        break;
      default:
        i -= 1;
    }
  }
  return { verb, opts };
}

function openDb(dbPath: string): Database {
  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  ensureV2Schema(db);
  return db;
}

async function main(): Promise<void> {
  const { verb, opts } = parseArgs(process.argv);
  const db = openDb(opts.dbPath);
  const daemon = new Daemon(db, new SystemClock(), {
    daemonId: opts.daemonId,
    workerCapacity: opts.capacity,
    leaseTtlMs: opts.leaseTtlMs,
    heartbeatMs: Math.max(1_000, Math.floor(opts.leaseTtlMs / 3)),
    sweepIntervalMs: opts.sweepIntervalMs,
    stopBoundMs: opts.stopBoundMs,
    executor: new ShellCheckExecutor(db),
  });

  switch (verb) {
    case "run": {
      const started = await daemon.start();
      if (!started.ok && started.reason !== "already_running") {
        console.error(`monitor-daemon: start failed: ${started.reason}`);
        process.exit(1);
      }
      console.log(`monitor-daemon: RUNNING daemon=${opts.daemonId} capacity=${opts.capacity} interval_ms=${opts.intervalMs}`);
      const shutdown = async (signal: string) => {
        console.log(`monitor-daemon: ${signal} — draining`);
        await daemon.stop();
        await daemon.tick();
        process.exit(0);
      };
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      process.on("SIGINT", () => void shutdown("SIGINT"));
      for (;;) {
        await daemon.tick();
        await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
      }
    }
    case "status": {
      const status = daemon.status();
      console.log(
        `state=${status.state} leader_epoch=${status.leaderEpoch} capacity=${status.workerCapacity} ` +
          `queue_depth=${status.queueDepth} admitted=${status.admittedCount} leased=${status.leasedCount} ` +
          `running=${status.runningCount} retry_wait=${status.retryWaitCount} ` +
          `expired_leases=${status.expiredLeaseCount} terminal=${status.terminalCount}`
      );
      break;
    }
    case "start": {
      const result = await daemon.start();
      if (!result.ok) {
        console.error(`monitor-daemon: ${result.reason}`);
        process.exit(1);
      }
      console.log(`monitor-daemon: state=RUNNING daemon=${opts.daemonId}`);
      break;
    }
    case "pause":
    case "resume":
    case "drain":
    case "stop":
    case "recover":
    case "replace": {
      const result = await daemon[verb]();
      if (!result.ok) {
        console.error(`monitor-daemon: ${result.reason}`);
        process.exit(1);
      }
      const status = daemon.status();
      console.log(`monitor-daemon: ${verb} ok — state=${status.state} leader_epoch=${status.leaderEpoch}`);
      break;
    }
    default:
      console.error(
        `monitor-daemon: unknown verb '${verb}' — expected run|status|start|pause|resume|drain|stop|recover|replace`
      );
      process.exit(1);
  }
  db.close();
}

void main();
