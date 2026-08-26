import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BILLING_APP_SUBDIRS, getBillingAppHome } from "../src/core/app-home.js";

// Provision the effective billing home tree at mode 0700 (BUILD-SPEC §3.2/§4.4).
// The root is resolved via @hasna/paths (getBillingAppHome): the legacy
// ~/.hasna/billing default stays the effective home until the XDG data home is
// adopted, so provisioning always targets where the app will actually read and
// write. Best-effort; the app also creates dirs lazily.
const root = getBillingAppHome();
try {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const dir of BILLING_APP_SUBDIRS) mkdirSync(join(root, dir), { recursive: true, mode: 0o700 });
} catch {
  // best-effort
}
