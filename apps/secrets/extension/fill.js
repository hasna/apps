// Secrets Vault — form-fill logic (pure, fake-DOM testable).
//
// SECURITY CONTRACT: this module contains NO self-invoking code. It only
// exposes createFillPlan/applyFill. The content script that injects it
// registers a message listener; nothing fills a form unless the user clicks
// the Fill button and the listener receives the FILL message. No silent
// auto-fill, ever.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.SecretsFill = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const USERNAME_HINTS = ["user", "login", "email", "account", "mail"];
  const PASSWORD_HINTS = ["pass", "pwd"];

  function isFillable(el) {
    if (!el) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.type === "hidden") return false;
    // A field is fillable when it is rendered (offset geometry present) or is
    // the focused element.
    if (typeof el.offsetWidth === "number" && typeof el.offsetHeight === "number") {
      return el.offsetWidth > 0 || el.offsetHeight > 0;
    }
    return true;
  }

  function scoreUsername(el) {
    const haystack = [el.name, el.id, el.autocomplete, el.placeholder]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const hint of USERNAME_HINTS) {
      if (haystack.includes(hint)) {
        score += hint === "email" ? 2 : 1;
      }
    }
    if (el.type === "email") score += 3;
    return score;
  }

  function scorePassword(el) {
    const haystack = [el.name, el.id, el.autocomplete, el.placeholder]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const hint of PASSWORD_HINTS) {
      if (haystack.includes(hint)) score += 1;
    }
    if (el.autocomplete === "current-password") score += 2;
    return score;
  }

  /** Decide which visible fields a login belongs in. Never mutates anything. */
  function createFillPlan(doc) {
    const plan = { usernameField: null, passwordField: null };

    const passwordCandidates = Array.from(
      (doc.querySelectorAll ? doc.querySelectorAll('input[type="password"]') : []) || [],
    )
      .filter(isFillable)
      .sort((a, b) => scorePassword(b) - scorePassword(a));
    if (passwordCandidates.length > 0) plan.passwordField = passwordCandidates[0];

    const textCandidates = Array.from(
      (doc.querySelectorAll
        ? doc.querySelectorAll('input:not([type]), input[type="text"], input[type="email"]')
        : []) || [],
    )
      .filter(isFillable)
      .filter((el) => el !== plan.usernameField)
      .sort((a, b) => scoreUsername(b) - scoreUsername(a));
    if (textCandidates.length > 0) plan.usernameField = textCandidates[0];

    return plan;
  }

  function fire(el, type) {
    if (typeof el.events === "object" && Array.isArray(el.events)) el.events.push(type);
    if (typeof el.dispatchEvent !== "function") return;
    try {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    } catch {
      /* frameworks that cannot see the event still get the value set */
    }
  }

  /** Write credentials into the planned fields; returns the number of fields filled. */
  function applyFill(doc, plan, credentials) {
    let filled = 0;
    if (plan.passwordField && credentials.password) {
      plan.passwordField.value = credentials.password;
      fire(plan.passwordField, "input");
      fire(plan.passwordField, "change");
      filled += 1;
    }
    if (plan.usernameField && credentials.username) {
      plan.usernameField.value = credentials.username;
      fire(plan.usernameField, "input");
      fire(plan.usernameField, "change");
      filled += 1;
    }
    return filled;
  }

  return { createFillPlan, applyFill };
});
