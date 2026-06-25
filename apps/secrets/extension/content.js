/**
 * Secrets Vault content script.
 * Detects fillable forms and asks the local vault for page-specific matches.
 */

let panelHost = null;
let panelRoot = null;
let lastMatchKey = "";
let checkTimer = null;

function visibleField(el) {
  if (!el || el.disabled || el.readOnly) return false;
  const type = (el.type || "").toLowerCase();
  if (["hidden", "submit", "button", "reset", "image", "file"].includes(type)) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function fieldLabel(el) {
  const parts = [
    el.getAttribute("autocomplete"),
    el.getAttribute("name"),
    el.getAttribute("id"),
    el.getAttribute("placeholder"),
    el.getAttribute("aria-label"),
  ];
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) parts.push(label.textContent);
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel) parts.push(wrappingLabel.textContent);
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function autocompleteTokens(el) {
  return (el.getAttribute("autocomplete") || "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^section-[^\s]+$/, ""))
    .filter(Boolean);
}

function addressFieldKind(el) {
  const tokens = autocompleteTokens(el);
  const text = fieldLabel(el);

  if (tokens.includes("name") || text.includes("full name")) return "name";
  if (tokens.includes("given-name") || text.includes("first name")) return "givenName";
  if (tokens.includes("family-name") || text.includes("last name")) return "familyName";
  if (tokens.includes("organization") || text.includes("company")) return "organization";
  if (tokens.includes("street-address")) return "streetAddress";
  if (tokens.includes("address-line1") || text.includes("address line 1") || text.includes("street")) return "addressLine1";
  if (tokens.includes("address-line2") || text.includes("address line 2") || text.includes("apt") || text.includes("suite")) return "addressLine2";
  if (tokens.includes("address-level2") || text.includes("city")) return "city";
  if (tokens.includes("address-level1") || text.includes("state") || text.includes("province")) return "state";
  if (tokens.includes("postal-code") || text.includes("postal") || text.includes("zip")) return "postalCode";
  if (tokens.includes("country") || text.includes("country")) return "country";
  if (tokens.includes("tel") || text.includes("phone")) return "phone";
  if (tokens.includes("email") || text.includes("email")) return "email";
  return null;
}

function paymentFieldKind(el) {
  const tokens = autocompleteTokens(el);
  const text = fieldLabel(el);

  if (tokens.includes("cc-name") || text.includes("cardholder")) return "cardName";
  if (tokens.includes("cc-number") || text.includes("card number")) return "cardNumber";
  if (tokens.includes("cc-exp")) return "expiration";
  if (tokens.includes("cc-exp-month") || text.includes("exp month")) return "expirationMonth";
  if (tokens.includes("cc-exp-year") || text.includes("exp year")) return "expirationYear";
  if (tokens.includes("cc-csc") || text.includes("security code") || text.includes("cvv") || text.includes("cvc")) return "securityCode";
  return null;
}

function findLoginFields() {
  const passwordFields = Array.from(document.querySelectorAll('input[type="password"]')).filter(visibleField);
  if (!passwordFields.length) return null;

  const password = passwordFields[0];
  const inputs = Array.from(document.querySelectorAll("input")).filter(visibleField);
  const passwordIndex = inputs.indexOf(password);
  let username = null;

  for (let i = passwordIndex - 1; i >= 0; i--) {
    const input = inputs[i];
    const type = (input.type || "").toLowerCase();
    if (["checkbox", "radio"].includes(type)) continue;
    username = input;
    break;
  }

  return { username, password };
}

function findPageFields() {
  const fields = Array.from(document.querySelectorAll("input, textarea, select")).filter(visibleField);
  const address = {};
  const payment = {};

  for (const field of fields) {
    const addressKind = addressFieldKind(field);
    if (addressKind && !address[addressKind]) address[addressKind] = field;

    const paymentKind = paymentFieldKind(field);
    if (paymentKind && !payment[paymentKind]) payment[paymentKind] = field;
  }

  return {
    login: findLoginFields(),
    address,
    payment,
  };
}

function hasAddressFields(fields) {
  return Object.keys(fields.address).length >= 2;
}

function hasPaymentFields(fields) {
  return Object.keys(fields.payment).length >= 2;
}

function usableMatch(match, fields) {
  if (match.source === "legacy") return Boolean(fields.login);
  if (match.kind === "login") return Boolean(fields.login);
  if (match.kind === "address" || match.kind === "identity") return hasAddressFields(fields);
  if (match.kind === "payment_card") return hasPaymentFields(fields);
  return false;
}

function setNativeValue(el, value) {
  if (!el || value == null || value === "") return;
  const stringValue = String(value);

  if (el.tagName === "SELECT") {
    const normalized = stringValue.trim().toLowerCase();
    const option = Array.from(el.options).find((entry) =>
      entry.value.toLowerCase() === normalized ||
      entry.textContent.trim().toLowerCase() === normalized
    );
    el.value = option ? option.value : stringValue;
  } else {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) nativeSetter.call(el, stringValue);
    el.value = stringValue;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function firstValue(data, keys) {
  for (const key of keys) {
    if (data[key] != null && data[key] !== "") return data[key];
  }
  return "";
}

function fillLogin(data, fields) {
  if (!fields.login) return false;
  setNativeValue(fields.login.username, firstValue(data, ["username", "email", "login"]));
  setNativeValue(fields.login.password, data.password);
  return true;
}

function fillAddress(data, fields) {
  const fullName = firstValue(data, ["name", "fullName"]);
  const mapping = {
    name: fullName,
    givenName: data.givenName,
    familyName: data.familyName,
    organization: firstValue(data, ["organization", "company"]),
    streetAddress: firstValue(data, ["streetAddress", "address", "addressLine1"]),
    addressLine1: firstValue(data, ["addressLine1", "streetAddress", "line1"]),
    addressLine2: firstValue(data, ["addressLine2", "line2"]),
    city: data.city,
    state: data.state,
    postalCode: firstValue(data, ["postalCode", "zip"]),
    country: data.country,
    phone: data.phone,
    email: data.email,
  };

  let filled = false;
  for (const [kind, field] of Object.entries(fields.address)) {
    if (mapping[kind]) {
      setNativeValue(field, mapping[kind]);
      filled = true;
    }
  }
  return filled;
}

function fillPayment(data, fields) {
  const mapping = {
    cardName: firstValue(data, ["cardName", "name"]),
    cardNumber: data.cardNumber,
    expiration: firstValue(data, ["expiration", "expiry"]),
    expirationMonth: firstValue(data, ["expirationMonth", "expMonth"]),
    expirationYear: firstValue(data, ["expirationYear", "expYear"]),
    securityCode: firstValue(data, ["securityCode", "cvv", "cvc"]),
  };

  let filled = false;
  for (const [kind, field] of Object.entries(fields.payment)) {
    if (mapping[kind]) {
      setNativeValue(field, mapping[kind]);
      filled = true;
    }
  }
  return filled;
}

function fillMatch(match, item, fields) {
  const data = item?.data || match;
  if (match.source === "legacy" || item?.kind === "login" || match.kind === "login") return fillLogin(data, fields);
  if (item?.kind === "address" || item?.kind === "identity" || match.kind === "address" || match.kind === "identity") return fillAddress(data, fields);
  if (item?.kind === "payment_card" || match.kind === "payment_card") return fillPayment(data, fields);
  return false;
}

function removePanel() {
  if (panelHost) {
    panelHost.remove();
    panelHost = null;
    panelRoot = null;
  }
}

function matchIdentity(match) {
  return match.source === "vault_item" ? match.id : match.key_prefix;
}

function matchTitle(match) {
  return match.title || match.label || match.key_prefix || "Vault item";
}

function firstVisibleAnchor(fields) {
  return fields.login?.password
    || fields.login?.username
    || Object.values(fields.address).find(Boolean)
    || Object.values(fields.payment).find(Boolean)
    || null;
}

function positionPanel(host, fields) {
  const anchor = firstVisibleAnchor(fields);
  const rect = anchor?.getBoundingClientRect?.();
  if (!rect) {
    host.style.left = "18px";
    host.style.top = "18px";
    host.style.right = "auto";
    host.style.bottom = "auto";
    return;
  }

  const margin = 12;
  const width = 320;
  const left = Math.min(window.innerWidth - width - margin, Math.max(margin, rect.left));
  const top = Math.min(window.innerHeight - 260 - margin, Math.max(margin, rect.bottom + margin));
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
  host.style.right = "auto";
  host.style.bottom = "auto";
}

function showPanel(matches, fields) {
  const key = matches.map(matchIdentity).join("|");
  if (panelHost && lastMatchKey === key) {
    positionPanel(panelHost, fields);
    return;
  }
  removePanel();
  lastMatchKey = key;

  panelHost = document.createElement("div");
  panelHost.id = "__secrets-vault-panel__";
  Object.assign(panelHost.style, {
    position: "fixed",
    zIndex: "2147483647",
    width: "320px",
    maxWidth: "min(320px, calc(100vw - 24px))",
    color: "#1f2937",
    background: "transparent",
  });

  panelRoot = panelHost.attachShadow({ mode: "open" });

  const shell = document.createElement("div");
  Object.assign(shell.style, {
    color: "#1f2937",
    background: "#ffffff",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    boxShadow: "0 14px 35px rgba(15, 23, 42, 0.22)",
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
    fontSize: "13px",
    overflow: "hidden",
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "9px 10px",
    borderBottom: "1px solid #e5e7eb",
    background: "#f9fafb",
  });

  const title = document.createElement("div");
  title.textContent = "Secrets";
  Object.assign(title.style, { fontWeight: "650", color: "#111827" });

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "x";
  close.title = "Hide";
  Object.assign(close.style, {
    width: "24px",
    height: "24px",
    border: "0",
    background: "transparent",
    color: "#6b7280",
    cursor: "pointer",
    fontSize: "14px",
  });
  close.addEventListener("click", removePanel);

  header.append(title, close);
  shell.appendChild(header);

  const list = document.createElement("div");
  Object.assign(list.style, { display: "grid", gap: "0", maxHeight: "220px", overflow: "auto" });

  for (const match of matches.slice(0, 5)) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = matchTitle(match);
    Object.assign(button.style, {
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: "8px",
      alignItems: "center",
      width: "100%",
      border: "0",
      borderBottom: "1px solid #f3f4f6",
      background: "#ffffff",
      color: "#111827",
      cursor: "pointer",
      padding: "10px",
      textAlign: "left",
    });

    const text = document.createElement("span");
    text.textContent = matchTitle(match);
    Object.assign(text.style, {
      minWidth: "0",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontWeight: "550",
    });

    const action = document.createElement("span");
    action.textContent = "Fill";
    Object.assign(action.style, {
      color: "#0f766e",
      fontWeight: "650",
      fontSize: "12px",
    });

    button.append(text, action);
    button.addEventListener("click", () => {
      if (match.source !== "vault_item") {
        const ok = fillMatch(match, null, fields);
        action.textContent = ok ? "Filled" : "No fields";
        setTimeout(removePanel, ok ? 900 : 1800);
        return;
      }

      chrome.runtime.sendMessage({ type: "ITEM_GET", id: match.id }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (!resp?.ok) {
          action.textContent = "Error";
          return;
        }
        const ok = fillMatch(match, resp.item, fields);
        action.textContent = ok ? "Filled" : "No fields";
        setTimeout(removePanel, ok ? 900 : 1800);
      });
    });
    list.appendChild(button);
  }

  shell.appendChild(list);
  panelRoot.appendChild(shell);
  document.body.appendChild(panelHost);
  positionPanel(panelHost, fields);
}

function checkPage() {
  const fields = findPageFields();
  if (!fields.login && !hasAddressFields(fields) && !hasPaymentFields(fields)) {
    removePanel();
    return;
  }

  chrome.runtime.sendMessage({ type: "MATCH", url: window.location.href }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (!resp?.ok || !resp.matches?.length) {
      removePanel();
      return;
    }
    const matches = resp.matches.filter((match) => usableMatch(match, fields));
    if (!matches.length) {
      removePanel();
      return;
    }
    showPanel(matches, fields);
  });
}

function scheduleCheckPage() {
  window.clearTimeout(checkTimer);
  checkTimer = window.setTimeout(checkPage, 200);
}

checkPage();

const observer = new MutationObserver(() => {
  scheduleCheckPage();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("focusin", scheduleCheckPage, true);
window.addEventListener("resize", () => {
  if (panelHost) positionPanel(panelHost, findPageFields());
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") removePanel();
}, true);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "AUTOFILL") return;
  const fields = findPageFields();
  fillMatch(msg.match || msg, msg.item, fields);
});
