// One service registration; PostgreSQL is validated when the command runs.
// Registration itself also serves help and MCP configuration without I/O.
export { registerServeCommands } from "./serve.remote.js";
