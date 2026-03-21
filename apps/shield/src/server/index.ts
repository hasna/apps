#!/usr/bin/env node
import { startServer } from "./serve.js";

const port = parseInt(process.env.PORT || "19428");
startServer(port);
