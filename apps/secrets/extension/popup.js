// Secrets Vault — popup controller.
//
// Flow: detect the active tab's site -> ask the native host (through the
// background worker) whether the local vault is usable -> search matches by
// hostname -> Fill injects the content script and sends the credentials for
// THIS tab only, on THIS click. Add stores a login with the site as the
// per-site label. Nothing is written to chrome.storage.
(() => {
  const site = window.SecretsSite;

  const $ = (id) => document.getElementById(id);

  const els = {
    site: $("site"),
    status: $("status"),
    authPending: $("auth-pending"),
    authFail: $("auth-fail"),
    authFailReason: $("auth-fail-reason"),
    authOk: $("auth-ok"),
    query: $("query"),
    results: $("results"),
    fTitle: $("f-title"),
    fUrl: $("f-url"),
    fUsername: $("f-username"),
    fPassword: $("f-password"),
    addBtn: $("add-btn"),
    addMsg: $("add-msg"),
  };

  function showStatus(kind, text) {
    els.status.className = `status ${kind}`;
    els.status.textContent = text;
    els.status.classList.remove("hidden");
  }

  function clearStatus() {
    els.status.classList.add("hidden");
  }

  async function currentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  function ask(verb, payload = {}) {
    return chrome.runtime.sendMessage({ verb, ...payload });
  }

  function renderItems(items) {
    els.results.textContent = "";
    if (!items || items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No logins for this site yet. Add one below.";
      els.results.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "item";

      const meta = document.createElement("div");
      meta.className = "meta";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = item.title || "(untitled)";
      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = item.subtitle || item.kind || "";
      meta.append(title, sub);

      const btn = document.createElement("button");
      btn.className = "fill-btn";
      btn.textContent = "Fill";
      btn.addEventListener("click", () => fillIntoPage(item.id));

      row.append(meta, btn);
      els.results.appendChild(row);
    }
  }

  async function refreshMatches() {
    const tab = await currentTab();
    if (!tab || !tab.url) return;
    const host = site.normalizeHost(tab.url);
    if (!host) {
      renderItems([]);
      return;
    }
    const res = await ask("search", { query: host });
    if (!res || !res.ok) {
      renderItems([]);
      showStatus("error", (res && res.error) || "Search failed");
      return;
    }
    renderItems(res.data.items);
  }

  async function fillIntoPage(itemId) {
    const tab = await currentTab();
    if (!tab || !tab.id || !tab.url) return;
    const host = site.normalizeHost(tab.url);
    if (!host) {
      showStatus("error", "This page is not a web site — nothing to fill.");
      return;
    }
    const got = await ask("get", { id: itemId });
    if (!got || !got.ok) {
      showStatus("error", (got && got.error) || "Could not read the login");
      return;
    }
    const creds = got.data.item.data || {};
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["fill.js", "content.js"],
      });
    } catch (err) {
      showStatus("error", `Cannot reach this page: ${String((err && err.message) || err)}`);
      return;
    }
    const filled = await chrome.tabs.sendMessage(tab.id, {
      type: "FILL",
      credentials: { username: creds.username, password: creds.password },
    });
    if (!filled || !filled.ok) {
      showStatus("error", (filled && filled.error) || "Fill failed");
      return;
    }
    showStatus(
      "ok",
      filled.filled === 0
        ? "No fillable fields found on this page"
        : `Filled ${filled.filled} field${filled.filled === 1 ? "" : "s"} on this page`,
    );
    window.close();
  }

  async function addLogin() {
    const tab = await currentTab();
    const title = els.fTitle.value.trim();
    const url = els.fUrl.value.trim();
    const username = els.fUsername.value.trim();
    const password = els.fPassword.value;

    if (!title || !username || !password) {
      els.addMsg.className = "add-msg error";
      els.addMsg.textContent = "Title, username and password are required.";
      return;
    }
    const res = await ask("add-login", { title, url, username, password });
    if (!res || !res.ok) {
      els.addMsg.className = "add-msg error";
      els.addMsg.textContent = (res && res.error) || "Could not save the login";
      return;
    }
    els.fPassword.value = "";
    els.addMsg.className = "add-msg ok";
    els.addMsg.textContent = `Saved ${title} to your vault.`;
    els.addMsg.dataset.savedId = res.data.id;
    await refreshMatches();
  }

  async function init() {
    const tab = await currentTab();
    const origin = tab && tab.url ? site.fullOrigin(tab.url) : null;
    const host = tab && tab.url ? site.normalizeHost(tab.url) : null;
    els.site.textContent = origin || "No web page detected";
    if (host) els.fUrl.value = origin;

    const res = await ask("auth-status");
    els.authPending.classList.add("hidden");

    if (!res || !res.ok) {
      els.authFail.classList.remove("hidden");
      const reason = res && res.error ? res.error : "E_AUTH: vault unavailable";
      els.authFailReason.textContent = reason;
      return;
    }
    els.authOk.classList.remove("hidden");
    clearStatus();
    await refreshMatches();

    els.query.addEventListener("input", async () => {
      const q = els.query.value.trim();
      if (!q) {
        await refreshMatches();
        return;
      }
      const res = await ask("search", { query: q });
      if (res && res.ok) renderItems(res.data.items);
    });

    els.addBtn.addEventListener("click", addLogin);
  }

  init().catch((err) => {
    els.authPending.classList.add("hidden");
    els.authFail.classList.remove("hidden");
    els.authFailReason.textContent = `E_INTERNAL: ${String((err && err.message) || err)}`;
  });
})();
