/**
 * Secrets Vault — Content Script
 * Detects login forms and shows an autofill button when matching secrets exist.
 */

let _autofillBtn = null;

function findLoginFields() {
  const pwFields = Array.from(document.querySelectorAll('input[type="password"]'));
  if (!pwFields.length) return null;

  const pw = pwFields[0];
  const allInputs = Array.from(document.querySelectorAll("input"));
  const pwIndex = allInputs.indexOf(pw);

  // Find a username/email field — prefer one right before the password field
  let user = null;
  for (let i = pwIndex - 1; i >= 0; i--) {
    const inp = allInputs[i];
    if (inp.type === "hidden" || inp.type === "submit" || inp.type === "button") continue;
    user = inp;
    break;
  }

  return { pwField: pw, userField: user };
}

function removeAutofillBtn() {
  if (_autofillBtn) {
    _autofillBtn.remove();
    _autofillBtn = null;
  }
}

function showAutofillBtn(match, fields) {
  removeAutofillBtn();

  const btn = document.createElement("button");
  btn.id = "__secrets-vault-fill__";
  btn.type = "button";
  btn.textContent = "🔐 Fill credentials";
  btn.title = match.label || match.key_prefix;

  Object.assign(btn.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: "2147483647",
    background: "#0d0d1a",
    color: "#00d4ff",
    border: "1.5px solid #00d4ff",
    borderRadius: "8px",
    padding: "9px 18px",
    cursor: "pointer",
    fontSize: "13px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontWeight: "500",
    boxShadow: "0 4px 20px rgba(0,212,255,0.25)",
    transition: "opacity 0.2s",
  });

  btn.addEventListener("mouseenter", () => { btn.style.background = "#1a1a2e"; });
  btn.addEventListener("mouseleave", () => { btn.style.background = "#0d0d1a"; });

  btn.addEventListener("click", e => {
    e.stopPropagation();
    e.preventDefault();
    fillFields(match, fields);
    btn.textContent = "✓ Filled!";
    btn.style.color = "#00ff88";
    btn.style.borderColor = "#00ff88";
    setTimeout(removeAutofillBtn, 1800);
  });

  document.body.appendChild(btn);
  _autofillBtn = btn;
}

function fillFields(match, fields) {
  function setNativeValue(el, value) {
    if (!el) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    if (nativeSetter) nativeSetter.call(el, value);
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (match.username && fields.userField) setNativeValue(fields.userField, match.username);
  if (match.password && fields.pwField) setNativeValue(fields.pwField, match.password);
}

function checkPage() {
  const fields = findLoginFields();
  if (!fields) {
    removeAutofillBtn();
    return;
  }

  chrome.runtime.sendMessage({ type: "MATCH", url: window.location.href }, resp => {
    if (chrome.runtime.lastError) return; // extension context invalidated
    if (!resp?.ok || !resp.matches?.length) return;
    showAutofillBtn(resp.matches[0], fields);
  });
}

// Initial check
checkPage();

// Watch for SPA navigation / dynamic form injection
const observer = new MutationObserver(() => {
  if (findLoginFields() && !_autofillBtn) checkPage();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

// Handle autofill command from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "AUTOFILL") return;
  const fields = findLoginFields();
  if (!fields) return;
  fillFields(msg, fields);
});
