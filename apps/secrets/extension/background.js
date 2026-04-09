const BASE_URL = "http://127.0.0.1:27462";

async function getToken() {
  const { token } = await chrome.storage.local.get("token");
  return token ?? "";
}

async function apiFetch(path, params = {}) {
  const token = await getToken();
  if (!token) throw new Error("No token configured. Open extension Options and paste your serve token.");
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`API ${resp.status}: ${body || resp.statusText}`);
  }
  return resp.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case "HEALTH":
      fetch(BASE_URL + "/health")
        .then(r => r.json())
        .then(d => sendResponse({ ok: true, data: d }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case "MATCH":
      apiFetch("/v1/match", { url: msg.url })
        .then(d => sendResponse({ ok: true, matches: d.matches }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case "SEARCH":
      apiFetch("/v1/search", { q: msg.q })
        .then(d => sendResponse({ ok: true, results: d.results }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case "LIST":
      apiFetch("/v1/list", msg.namespace ? { namespace: msg.namespace } : {})
        .then(d => sendResponse({ ok: true, secrets: d.secrets }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case "GET":
      apiFetch("/v1/get", { key: msg.key })
        .then(d => sendResponse({ ok: true, secret: d }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
  }
});
