import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const adminToken = process.env.OPEN_SIGNATURES_ADMIN_TOKEN ?? process.env.SIGNATURES_ADMIN_TOKEN;
const loopbackApiProxyGuard: Plugin = {
  name: "open-signatures-loopback-api-proxy-guard",
  configureServer(server) {
    server.middlewares.use("/api", (req, res, next) => {
      if (isLoopbackAddress(req.socket.remoteAddress)) {
        next();
        return;
      }

      res.statusCode = 403;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("The Open Signatures API proxy only accepts loopback requests.");
    });
  },
};

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export default defineConfig({
  plugins: [react(), loopbackApiProxyGuard],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:19440",
        headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined,
      },
      "/health": "http://localhost:19440",
    },
  },
});
