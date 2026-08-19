// Secrets Vault — content script, injected ONLY on explicit user action
// (the popup's Fill button, via chrome.scripting.executeScript). It registers
// a message listener and performs no DOM writes at load time: the page is
// never touched until the user clicks Fill and the FILL message arrives.
(() => {
  const fill = (typeof window !== "undefined" && window.SecretsFill) || null;
  if (!fill) return;

  // The popup may inject this script on every Fill click; register the
  // listener exactly once per page.
  if (window.__secretsVaultInjected) return;
  window.__secretsVaultInjected = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "FILL") return;
    try {
      const plan = fill.createFillPlan(document);
      const filled = fill.applyFill(document, plan, msg.credentials || {});
      sendResponse({
        ok: true,
        filled,
        username: Boolean(plan.usernameField),
        password: Boolean(plan.passwordField),
      });
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  });
})();
