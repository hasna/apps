// Popup UI script

async function getSessionStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;

  return new Promise<any>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "get-status" },
      (response) => resolve(response)
    );
  });
}

function getErrorSummary() {
  return new Promise<any[]>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "get-errors" },
      (response) => resolve(response?.errors || [])
    );
  });
}

async function updateUI() {
  const status = await getSessionStatus();
  if (!status) {
    document.getElementById("status")!.textContent = "No active tab";
    return;
  }

  document.getElementById("navCount")!.textContent =
    status.entryCount > 0 ? countByType(status.entries || [], "navigation").toString() : "0";
  document.getElementById("consoleCount")!.textContent =
    status.entryCount > 0 ? countByType(status.entries || [], "console").toString() : "0";
  document.getElementById("errorCount")!.textContent =
    status.entryCount > 0 ? countByType(status.entries || [], "error").toString() : "0";
}

function countByType(entries: any[], type: string): number {
  return entries.filter((e: any) => e.type === type).length;
}

// Export session as JSON download
document.getElementById("exportBtn")!.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const session = await new Promise<any>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "export-session", tabId: tab.id },
      (response) => resolve(response)
    );
  });

  if (!session) return;

  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `testers-session-${session.sessionId.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Copy session JSON to clipboard
document.getElementById("copyBtn")!.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const session = await new Promise<any>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "export-session", tabId: tab.id },
      (response) => resolve(response)
    );
  });

  if (!session) return;

  await navigator.clipboard.writeText(JSON.stringify(session, null, 2));

  const btn = document.getElementById("copyBtn")! as HTMLButtonElement;
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => { btn.textContent = original; }, 1500);
});

// Clear session data
document.getElementById("clearBtn")!.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  chrome.runtime.sendMessage({ type: "clear-session", tabId: tab.id });
  updateUI();
});

updateUI();

// Refresh every 2 seconds
setInterval(updateUI, 2000);
