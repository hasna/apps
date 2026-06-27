const $ = id => document.getElementById(id);

function setStatus(msg, type = "ok") {
  const el = $("status");
  el.textContent = msg;
  el.className = type;
}

async function loadToken() {
  const { token } = await chrome.storage.local.get("token");
  if (token) $("token").value = token;
}

$("save-btn").addEventListener("click", async () => {
  const token = $("token").value.trim();
  if (!token) { setStatus("Token cannot be empty", "err"); return; }
  await chrome.storage.local.set({ token });
  setStatus("✓ Saved", "ok");
  setTimeout(() => setStatus(""), 3000);
});

$("forget-btn").addEventListener("click", async () => {
  await chrome.storage.local.remove("token");
  $("token").value = "";
  setStatus("Token cleared", "ok");
  setTimeout(() => setStatus(""), 3000);
});

$("test-btn").addEventListener("click", async () => {
  const token = $("token").value.trim();
  setStatus("Testing…");
  try {
    const healthResp = await fetch("http://127.0.0.1:27462/health");
    if (!healthResp.ok) throw new Error("Server returned error");
    await healthResp.json();

    if (!token) {
      setStatus("Server is reachable but no token entered", "err");
      return;
    }

    const listResp = await fetch("http://127.0.0.1:27462/v1/list", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (listResp.status === 401) {
      setStatus("✗ Token is invalid", "err");
      return;
    }

    const data = await listResp.json();
    const count = data.secrets?.length ?? 0;
    setStatus(`✓ Connected — ${count} secret${count !== 1 ? "s" : ""} in vault`, "ok");
  } catch {
    setStatus("✗ Cannot reach server. Make sure secrets serve is running.", "err");
  }
});

loadToken();
