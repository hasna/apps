import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [prefix, portFile] = process.argv.slice(2);
const putStatus = Number(process.env.CAPTURE_PUT_STATUS ?? "201");
let requestIndex = 0;

if (!prefix || !portFile) {
  throw new Error("usage: capture_registry.js <output-prefix> <port-file>");
}

const server = createServer((request, response) => {
  const chunks = [];

  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    requestIndex += 1;
    const body = Buffer.concat(chunks);
    writeFileSync(
      `${prefix}.request-${requestIndex}.json`,
      JSON.stringify(
        {
          method: request.method,
          url: request.url,
          bodyBytes: body.length,
        },
        null,
        2,
      ),
    );

    if (request.method === "PUT") {
      writeFileSync(`${prefix}.put.json`, body);
      response.writeHead(putStatus, { "content-type": "application/json" });
      response.end(JSON.stringify(putStatus < 400 ? { ok: true } : { error: "probe_failure" }));
      setTimeout(() => server.close(), 25);
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
});

server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
});
