#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import App from "./App.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("terminal: ANTHROPIC_API_KEY is not set.");
  console.error("Add it to your shell: export ANTHROPIC_API_KEY=your_key");
  process.exit(1);
}

render(<App />);
