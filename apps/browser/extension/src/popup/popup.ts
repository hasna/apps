import type { ExtensionStorageState } from "../protocol";

const serverInput = document.getElementById("server-url") as HTMLInputElement;
const codeInput = document.getElementById("pair-code") as HTMLInputElement;
const pairButton = document.getElementById("pair") as HTMLButtonElement;
const unpairButton = document.getElementById("unpair") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

function setStatus(state: ExtensionStorageState): void {
  const status = state.status ?? "idle";
  statusEl.dataset.state = status;
  const detail = state.lastError || state.lastSeenAt || "";
  statusEl.textContent = detail ? `${status} · ${detail}` : status;
  if (state.serverUrl) serverInput.value = state.serverUrl;
}

function sendMessage<T = ExtensionStorageState>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response as T));
  });
}

async function refresh(): Promise<void> {
  setStatus(await sendMessage({ type: "STATUS" }));
}

pairButton.addEventListener("click", async () => {
  pairButton.disabled = true;
  try {
    const state = await sendMessage({
      type: "PAIR",
      serverUrl: serverInput.value.trim(),
      code: codeInput.value.trim(),
      name: "Chrome",
    });
    setStatus(state);
  } finally {
    pairButton.disabled = false;
  }
});

unpairButton.addEventListener("click", async () => {
  unpairButton.disabled = true;
  try {
    setStatus(await sendMessage({ type: "UNPAIR" }));
  } finally {
    unpairButton.disabled = false;
  }
});

void refresh();
