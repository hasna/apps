// Child-process fixture: no real network access, no application database.
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.origin !== "https://access.example.test" || init?.redirect !== "error") throw new Error("Unsafe test transport");
  if (new Headers(init.headers).get("Authorization") !== "Bearer isolated-cli-test") return new Response(null, { status: 401 });
  return Response.json({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(String(init.body)) : null });
}) as typeof fetch;
