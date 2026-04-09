const $ = id => document.getElementById(id);

let allSecrets = [];
let currentTab = null;

// ── Utilities ─────────────────────────────────────────

function setStatus(msg, type = "ok") {
  const bar = $("status-bar");
  bar.textContent = msg;
  bar.className = type;
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

// ── Rendering ─────────────────────────────────────────

function renderItem(s, { showFill = false } = {}) {
  const item = document.createElement("div");
  item.className = "secret-item";

  // Info
  const info = document.createElement("div");
  info.className = "secret-info";

  const key = document.createElement("div");
  key.className = "secret-key";
  key.textContent = s.key;
  key.title = s.key;

  const meta = document.createElement("div");
  meta.className = "secret-meta";
  const parts = [s.type];
  if (s.label) parts.unshift(s.label);
  meta.textContent = parts.join(" · ");

  info.append(key, meta);

  // Actions
  const actions = document.createElement("div");
  actions.className = "secret-actions";

  if (showFill && (s.username || s.password)) {
    const fillBtn = document.createElement("button");
    fillBtn.className = "fill";
    fillBtn.textContent = "⌨ Fill";
    fillBtn.onclick = () => {
      if (!currentTab?.id) return;
      chrome.tabs.sendMessage(currentTab.id, {
        type: "AUTOFILL",
        username: s.username,
        password: s.password,
      });
      window.close();
    };
    actions.appendChild(fillBtn);
  }

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy";
  copyBtn.onclick = async e => {
    e.stopPropagation();
    try {
      if (s.value != null) {
        await copyText(s.value);
      } else {
        // Fetch value from server
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ type: "GET", key: s.key }, resp => {
            if (resp?.ok) {
              copyText(resp.secret.value).then(resolve).catch(reject);
            } else {
              reject(new Error(resp?.error ?? "Failed"));
            }
          });
        });
      }
      copyBtn.textContent = "✓";
      copyBtn.classList.add("copied");
      setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.classList.remove("copied"); }, 1200);
    } catch (e) {
      setStatus(e.message, "err");
    }
  };
  actions.appendChild(copyBtn);

  item.append(info, actions);
  return item;
}

function renderList(list, container, opts = {}) {
  container.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No secrets found";
    container.appendChild(empty);
    return;
  }
  for (const s of list.slice(0, 80)) {
    container.appendChild(renderItem(s, opts));
  }
}

// ── Initialisation ─────────────────────────────────────

async function init() {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Health check
  chrome.runtime.sendMessage({ type: "HEALTH" }, resp => {
    if (resp?.ok) {
      setStatus("Connected to vault", "ok");
    } else {
      setStatus("Server not running — run: secrets serve", "err");
    }
  });

  // Page match check
  if (tab?.url) {
    chrome.runtime.sendMessage({ type: "MATCH", url: tab.url }, resp => {
      if (!resp?.ok || !resp.matches?.length) return;
      $("matches-section").classList.remove("hidden");
      renderList(resp.matches, $("matches-list"), { showFill: true });
    });
  }

  // Load all secrets (metadata only — no values)
  chrome.runtime.sendMessage({ type: "LIST" }, resp => {
    if (resp?.ok) {
      allSecrets = resp.secrets;
      renderList(allSecrets, $("results-list"));
    } else {
      $("results-list").innerHTML = `<div class="empty">${resp?.error ?? "Failed to load secrets"}</div>`;
    }
  });
}

// ── Search ─────────────────────────────────────────────

$("search").addEventListener("input", e => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) {
    renderList(allSecrets, $("results-list"));
    return;
  }
  const filtered = allSecrets.filter(s =>
    s.key.toLowerCase().includes(q) ||
    (s.label ?? "").toLowerCase().includes(q) ||
    (s.type ?? "").toLowerCase().includes(q)
  );
  renderList(filtered, $("results-list"));
});

$("options-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();
