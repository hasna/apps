// HTTP server placeholder for @hasna/brains
// Will expose REST API for model management and training data

const port = Number(process.env["PORT"] ?? 7020);

console.log(`brains server starting on port ${port}`);

Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "brains", version: "0.0.1" });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
});
