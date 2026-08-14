#!/usr/bin/env bun
import { startServer } from "./serve.js";
const port = parseInt(process.argv[2] || "19427", 10);
startServer(port, { open: false });
