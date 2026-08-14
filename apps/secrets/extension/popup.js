const $ = id => document.getElementById(id);

let allItems = [];
let allLegacySecrets = [];
let pageMatches = [];
let currentTab = null;
let activeTab = "page";
let activeKind = "";

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, resp => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp?.ok) {
        reject(new Error(resp?.error || "Request failed"));
        return;
      }
      resolve(resp);
    });
  });
}

function setStatus(msg, type = "ok") {
  const bar = $("status-bar");
  bar.textContent = msg;
  bar.className = type;
}

async function copyText(text) {
  await navigator.clipboard.writeText(String(text ?? ""));
}

function currentQuery() {
  return $("search").value.toLowerCase().trim();
}

function kindLabel(kind) {
  return String(kind || "item").replace(/_/g, " ");
}

function titleFor(entry) {
  return entry.title || entry.label || entry.key || entry.key_prefix || "Untitled";
}

function metaFor(entry) {
  if (entry.source === "legacy" || entry.key) return entry.label || entry.type || entry.key_prefix || "legacy secret";
  const bits = [];
  if (entry.subtitle) bits.push(entry.subtitle);
  if (entry.domains?.length) bits.push(entry.domains.join(", "));
  if (entry.tags?.length) bits.push(entry.tags.join(", "));
  return bits.join(" - ") || kindLabel(entry.kind);
}

function entryMatchesQuery(entry, q) {
  if (!q) return true;
  return [
    entry.id,
    entry.kind,
    entry.title,
    entry.subtitle,
    entry.key,
    entry.key_prefix,
    entry.label,
    entry.type,
    ...(entry.domains || []),
    ...(entry.tags || []),
  ].filter(Boolean).join(" ").toLowerCase().includes(q);
}

function canFill(entry) {
  if (!currentTab?.id) return false;
  if (entry.source === "legacy") return Boolean(entry.username || entry.password);
  return ["login", "address", "identity", "payment_card"].includes(entry.kind);
}

async function loadItem(id) {
  const resp = await send("ITEM_GET", { id });
  return resp.item;
}

function copyValueFromItem(item) {
  const data = item.data || {};
  return data.password
    ?? data.apiKey
    ?? data.token
    ?? data.cardNumber
    ?? data.body
    ?? data.email
    ?? data.username
    ?? JSON.stringify(data, null, 2);
}

async function fillEntry(entry) {
  if (!currentTab?.id) return;

  let message;
  if (entry.source === "legacy") {
    message = { type: "AUTOFILL", match: entry };
  } else {
    const item = entry.data ? entry : await loadItem(entry.id);
    message = {
      type: "AUTOFILL",
      match: { source: "vault_item", id: item.id, kind: item.kind, title: item.title },
      item,
    };
  }

  await chrome.tabs.sendMessage(currentTab.id, message);
  window.close();
}

function empty(container, message) {
  container.innerHTML = "";
  const el = document.createElement("div");
  el.className = "empty";
  el.textContent = message;
  container.appendChild(el);
}

function renderEntry(entry, container) {
  const row = document.createElement("div");
  row.className = "item";

  const main = document.createElement("div");
  main.className = "item-main";

  const titleRow = document.createElement("div");
  titleRow.className = "item-title-row";

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = entry.source === "legacy" || entry.key ? (entry.type || "legacy") : kindLabel(entry.kind);

  const title = document.createElement("div");
  title.className = "item-title";
  title.textContent = titleFor(entry);
  title.title = title.textContent;

  titleRow.append(badge, title);

  const meta = document.createElement("div");
  meta.className = "item-meta";
  meta.textContent = metaFor(entry);
  meta.title = meta.textContent;

  main.append(titleRow, meta);

  const actions = document.createElement("div");
  actions.className = "actions";

  if (canFill(entry)) {
    const fill = document.createElement("button");
    fill.className = "primary";
    fill.type = "button";
    fill.textContent = "Fill";
    fill.onclick = async () => {
      try {
        await fillEntry(entry);
      } catch (e) {
        setStatus(e.message, "err");
      }
    };
    actions.appendChild(fill);
  }

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy";
  copy.onclick = async () => {
    try {
      if (entry.key) {
        const resp = await send("GET", { key: entry.key });
        await copyText(resp.secret.value);
      } else if (entry.source === "legacy") {
        await copyText(entry.password || entry.username || "");
      } else {
        const item = entry.data ? entry : await loadItem(entry.id);
        await copyText(copyValueFromItem(item));
      }
      copy.textContent = "Done";
      setTimeout(() => { copy.textContent = "Copy"; }, 1200);
    } catch (e) {
      setStatus(e.message, "err");
    }
  };
  actions.appendChild(copy);

  row.append(main, actions);
  container.appendChild(row);
}

function renderList(entries, container, emptyMessage) {
  container.innerHTML = "";
  if (!entries.length) {
    empty(container, emptyMessage);
    return;
  }
  for (const entry of entries.slice(0, 100)) renderEntry(entry, container);
}

function render() {
  const q = currentQuery();
  renderList(
    pageMatches.filter(entry => entryMatchesQuery(entry, q)),
    $("matches-list"),
    "No matching vault items for this page."
  );

  const items = allItems
    .filter(item => !activeKind || item.kind === activeKind)
    .filter(item => entryMatchesQuery(item, q));
  renderList(items, $("items-list"), "No structured vault items found.");

  renderList(
    allLegacySecrets.filter(entry => entryMatchesQuery(entry, q)),
    $("legacy-list"),
    "No legacy secrets found."
  );
}

function setActiveTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach(panel => panel.classList.remove("active"));
  $(`${tab}-panel`).classList.add("active");
}

function setActiveKind(kind) {
  activeKind = kind;
  document.querySelectorAll(".filter").forEach(btn => btn.classList.toggle("active", btn.dataset.kind === kind));
  render();
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (tab?.url) {
    try {
      $("page-host").textContent = new URL(tab.url).hostname;
    } catch {
      $("page-host").textContent = "Current tab";
    }
  }

  try {
    await send("HEALTH");
    setStatus("Connected to local vault", "ok");
  } catch {
    setStatus("Server not running. Run: secrets serve", "err");
  }

  const loads = [];
  loads.push(send("ITEMS").then(resp => { allItems = resp.items || []; }));
  loads.push(send("LIST").then(resp => { allLegacySecrets = resp.secrets || []; }));
  if (tab?.url) {
    loads.push(send("MATCH", { url: tab.url }).then(resp => { pageMatches = resp.matches || []; }));
  }

  await Promise.allSettled(loads);
  if (pageMatches.length === 0 && allItems.length > 0) setActiveTab("items");
  render();
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
});

document.querySelectorAll(".filter").forEach(btn => {
  btn.addEventListener("click", () => setActiveKind(btn.dataset.kind));
});

$("search").addEventListener("input", render);

$("options-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init().catch((e) => setStatus(e.message, "err"));
