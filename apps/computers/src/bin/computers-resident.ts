#!/usr/bin/env bun
import { ResidentProtocol } from "../resident";
import { SQLiteStorage } from "../storage";

const storage = new SQLiteStorage(":memory:");
storage.migrate();
const protocol = new ResidentProtocol(storage);
process.stdout.write(`${JSON.stringify(protocol.doctor(), null, 2)}\n`);
storage.close();
process.exitCode = 1;
