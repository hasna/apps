#!/usr/bin/env bun
import { startServer } from "./serve.js";

const port = parseInt(Bun.env.SEARCH_PORT ?? Bun.env.PORT ?? "19800");

startServer(port);
