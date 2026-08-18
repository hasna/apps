// `emails inbox status` must not present a plausible number it cannot vouch for,
// and must not advertise a command that does not exist. Both defects were live in
// 1.3.0 and were found together on 2026-07-27 (2026-07-27).
//
// 1. THE COUNT. A stale explicit local-mode selector shadowed the
//    EMAILS_CLIENT_ENV_SECRET pointer, so this renderer printed
//    "Local inbox: 0 total, 0 unread" against a deployment holding ~170,000 messages.
//    It read as an empty mailbox, not as a misconfiguration. The selector is gone:
//    a pointer-configured client loads the pointer unconditionally (fail-closed),
//    and this renderer states the backend ABOVE the first count, so a silent
//    wrong-database read cannot present a confident zero any more.
//
// 2. THE HINT. It printed "Pull now: emails refresh", and `emails refresh` is not a
//    registered command ("error: unknown command 'refresh'"). The per-backend
//    filter could not save it, because the entry sat only under API_REFUSED_COMMANDS,
//    so the local SQLite client printed the dead verb happily. An operator
//    followed the hint and hit the dead end.

import { describe, expect, it } from "bun:test";
import { formatInboxSyncStatus } from "./inbox-sync-status-format.js";
import { statusAvailable, statusUnavailable } from "./status-availability.js";
import type { EmailSystemStatus } from "./status-types.js";

// The backend is a plain discriminated field on EmailSystemStatus.
type StatusBackend = EmailSystemStatus["backend"];

/** A status shaped like the blinded local read: zeroes, for the given backend. */
function emptyLocalStatus(backend: StatusBackend): EmailSystemStatus {
  const available = statusAvailable("local_database", "client_enumeration");
  return {
    generated_at: "2026-07-27T13:00:00.000Z",
    backend,
    degraded: false,
    limited: false,
    unavailable: [],
    failures: [],
    limitations: [],
    incomplete: [],
    gaps: {},
    database: { availability: available, data_dir: "/tmp/emails-test" },
    providers: { availability: available, total: 0, active: 0, by_type: {} },
    domains: {
      availability: available,
      total: 0, verified: 0, send_ready: 0, receive_ready: 0,
      usable: [], usable_limit: 25, usable_truncated: false,
    },
    addresses: {
      availability: available,
      total: 0, active: 0, verified: 0, owned: 0, ready_to_receive: 0,
      usable_from: [], usable_from_limit: 25, usable_from_truncated: false,
    },
    inbox: {
      total: 0, unread: 0, latest_received_at: null,
      inbound_buckets: { availability: available, items: [], total: 0 },
      realtime: {
        availability: available,
        queue_configured: false, queue_url: null, last_poll_at: null, last_error: null,
      },
    },
    mailboxes: { counts: { inbox: 0, unread: 0, sent: 0, archived: 0, spam: 0, trash: 0, starred: 0 }, folders: [] },
    sources: {
      availability: available,
      total: 0, active: 0, legacy: 0, orphaned: 0,
      items: [], limit: 50, truncated: false,
      configured: {
        availability: statusUnavailable("not_applicable", "local_mode", "local_database"),
        total: null, by_status: null, latest_last_synced_at: null,
      },
    },
    provisioning: {
      availability: available,
      domains_pending: 0, domains_failed: 0, addresses_pending: 0, addresses_failed: 0,
    },
    next_actions: [],
    cli_equivalents: {},
  };
}

describe("formatInboxSyncStatus — the client backend is stated above the counts", () => {
  const rendered = formatInboxSyncStatus(emptyLocalStatus("sqlite"));

  it("prints the backend ABOVE the inbox count", () => {
    // Order is the whole point: which store these numbers describe must be visible
    // before the first count is read. The mode-shadowing note this line replaced
    // is gone with the selector variable that could shadow a configured
    // client-env pointer.
    const backendAt = rendered.indexOf("Backend:");
    const countAt = rendered.indexOf("Local inbox:");
    expect(backendAt).toBeGreaterThan(-1);
    expect(countAt).toBeGreaterThan(-1);
    expect(backendAt).toBeLessThan(countAt);
  });

  it("still renders the ordinary payload", () => {
    expect(rendered).toContain("Local inbox: 0 total, 0 unread");
  });

  it("prints no mode note of any kind", () => {
    // The shadowed-pointer caveat is gone with the selector that could shadow:
    // a pointer-configured client loads it unconditionally, so there is nothing
    // left to caveat. Asserting absence pins the renderer to the current design.
    expect(rendered).not.toContain("Mode note:");
    expect(rendered).not.toContain("was overridden");
  });
});

describe("formatInboxSyncStatus — the pull hint names a real command", () => {
  const rendered = formatInboxSyncStatus(emptyLocalStatus("sqlite"));

  it("suggests `emails pull`, never `emails refresh`", () => {
    expect(rendered).toContain("Pull now: emails pull");
    expect(rendered).not.toContain("emails refresh");
  });

  it("omits the pull hint for the API client, where the server owns ingestion", () => {
    const out = formatInboxSyncStatus(emptyLocalStatus("api"));
    expect(out).not.toContain("emails pull");
    expect(out).not.toContain("emails refresh");
  });
});
