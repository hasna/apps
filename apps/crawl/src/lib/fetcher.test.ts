import { describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:net";
import { fetchPage } from "./fetcher.js";

async function startSlowBodyServer(delayMs: number): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  let bodyTimeout: ReturnType<typeof setTimeout> | null = null;
  const server: Server = createServer((socket) => {
    socket.once("data", () => {
      socket.write(
        "HTTP/1.1 200 OK\r\n" +
          "Content-Type: text/html; charset=utf-8\r\n" +
          "Content-Length: 22\r\n" +
          "Connection: close\r\n" +
          "\r\n"
      );

      bodyTimeout = setTimeout(() => {
        socket.end("<html>late body</html>");
      }, delayMs);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }

  return {
    url: `http://127.0.0.1:${address.port}/slow`,
    close: async () => {
      if (bodyTimeout) clearTimeout(bodyTimeout);
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

describe("fetchPage", () => {
  it("applies the timeout while reading a slow response body", async () => {
    const server = await startSlowBodyServer(200);

    try {
      const startedAt = performance.now();
      const result = await fetchPage(server.url, {
        delay: 0,
        timeout: 50,
      });

      expect(result.statusCode).toBe(0);
      expect(result.html).toBe("");
      expect(performance.now() - startedAt).toBeLessThan(150);
    } finally {
      await server.close();
    }
  });
});
