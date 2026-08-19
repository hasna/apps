// Form-fill tests for the Secrets Vault extension.
// The owner requirement: autofill happens ONLY on explicit user action (clicking
// the Fill button) — never silently on page load. These tests pin that contract:
//   - createFillPlan/applyFill live in ../fill.js (pure, fake-DOM testable)
//   - ../content.js is the injected wrapper: it registers a message listener and
//     performs NO DOM writes at load time (explicit-action-only proof).
// TDD: written before ../fill.js and ../content.js existed; must fail.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

const EXT_DIR = join(import.meta.dir, "..");

interface FakeField {
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  visible: boolean;
  value: string;
  events: string[];
  disabled?: boolean;
  readOnly?: boolean;
  offsetWidth: number;
  offsetHeight: number;
}

function makeField(overrides: Partial<FakeField>): FakeField {
  return {
    type: "text",
    name: "",
    id: "",
    autocomplete: "",
    visible: true,
    value: "",
    events: [],
    // The real DOM expresses visibility through layout geometry; fill.js's
    // isFillable() reads offsetWidth/offsetHeight, so the fake must too.
    offsetWidth: 1,
    offsetHeight: 1,
    ...overrides,
    ...(overrides.visible === false ? { offsetWidth: 0, offsetHeight: 0 } : {}),
  };
}

/** Minimal document fake: querySelectorAll understands the two selectors fill.js uses. */
function makeFakeDoc(fields: FakeField[]) {
  const matches = (sel: string): FakeField[] => {
    if (sel === 'input[type="password"]') {
      return fields.filter((f) => f.type === "password");
    }
    if (sel === 'input:not([type]), input[type="text"], input[type="email"]') {
      return fields.filter(
        (f) =>
          (f.type === "text" || f.type === "email" || f.type === "") && f.id !== "skip",
      );
    }
    if (sel === 'input[type="text"]') {
      return fields.filter((f) => f.type === "text");
    }
    return [];
  };
  return {
    querySelectorAll: (sel: string) => matches(sel),
    activeElement: null,
  };
}

describe("createFillPlan", () => {
  test("finds a visible password field and a username-candidate", async () => {
    const { createFillPlan } = await import(join(EXT_DIR, "fill.js"));
    const doc = makeFakeDoc([
      makeField({ type: "email", name: "email", id: "email" }),
      makeField({ type: "password", name: "password", id: "pass" }),
    ]);
    const plan = createFillPlan(doc);
    expect(plan.passwordField).not.toBeNull();
    expect(plan.passwordField!.id).toBe("pass");
    expect(plan.usernameField).not.toBeNull();
  });

  test("ranks a user-named field above a generic one", async () => {
    const { createFillPlan } = await import(join(EXT_DIR, "fill.js"));
    const doc = makeFakeDoc([
      makeField({ type: "text", name: "q", id: "search" }),
      makeField({ type: "text", name: "username", id: "user" }),
      makeField({ type: "password", name: "password", id: "pass" }),
    ]);
    const plan = createFillPlan(doc);
    expect(plan.usernameField!.id).toBe("user");
  });

  test("skips hidden fields", async () => {
    const { createFillPlan } = await import(join(EXT_DIR, "fill.js"));
    const doc = makeFakeDoc([
      makeField({ type: "password", name: "password", visible: false }),
      makeField({ type: "email", name: "email" }),
    ]);
    const plan = createFillPlan(doc);
    expect(plan.passwordField).toBeNull();
  });

  test("returns an empty plan when there is nothing to fill", async () => {
    const { createFillPlan } = await import(join(EXT_DIR, "fill.js"));
    const doc = makeFakeDoc([]);
    const plan = createFillPlan(doc);
    expect(plan.passwordField).toBeNull();
    expect(plan.usernameField).toBeNull();
  });
});

describe("applyFill", () => {
  test("writes values and reports the count", async () => {
    const { createFillPlan, applyFill } = await import(join(EXT_DIR, "fill.js"));
    const username = makeField({ type: "text", name: "username" });
    const password = makeField({ type: "password", name: "password" });
    const doc = makeFakeDoc([username, password]);
    const plan = createFillPlan(doc);
    const filled = applyFill(doc, plan, { username: "alice", password: "s3cret" });
    expect(filled).toBe(2);
    expect(username.value).toBe("alice");
    expect(password.value).toBe("s3cret");
  });

  test("fires input and change events so frameworks notice", async () => {
    const { createFillPlan, applyFill } = await import(join(EXT_DIR, "fill.js"));
    const password = makeField({ type: "password", name: "password" });
    const doc = makeFakeDoc([password]);
    const plan = createFillPlan(doc);
    applyFill(doc, plan, { username: "", password: "x" });
    expect(password.events).toContain("input");
    expect(password.events).toContain("change");
  });
});

describe("content.js — explicit action only", () => {
  // content.js executes exactly once per process (module cache), so the chrome
  // stub is shared across the tests of this block and the listener it records
  // is the single registration that happened at load.
  const listeners: Array<(msg: unknown, sender: unknown, respond: (r: unknown) => void) => void> = [];
  let savedChrome: unknown;
  let savedWindow: unknown;
  let fillModule: { createFillPlan: (d: unknown) => any; applyFill: (d: unknown, p: any, c: any) => number };

  beforeAll(async () => {
    fillModule = await import(join(EXT_DIR, "fill.js"));
    savedChrome = (globalThis as any).chrome;
    savedWindow = (globalThis as any).window;
    (globalThis as any).chrome = {
      runtime: {
        onMessage: {
          addListener: (fn: (m: unknown, s: unknown, r: (x: unknown) => void) => void) => {
            listeners.push(fn);
          },
        },
      },
    };
    (globalThis as any).window = { SecretsFill: fillModule, document: null };
    await import(join(EXT_DIR, "content.js"));
  });

  afterAll(() => {
    if (savedChrome !== undefined) (globalThis as any).chrome = savedChrome;
    if (savedWindow !== undefined) (globalThis as any).window = savedWindow;
  });

  test("load performs NO DOM writes and registers exactly one listener", async () => {
    const password = makeField({ type: "password", name: "password" });
    const username = makeField({ type: "text", name: "username" });
    const doc = makeFakeDoc([username, password]);
    const mutationsAtLoad = () =>
      [username, password].reduce((n, f) => n + f.events.length, 0) +
      (username.value.length + password.value.length);

    expect(listeners.length).toBe(1);
    expect(mutationsAtLoad()).toBe(0);

    (globalThis as any).document = doc;
    let response: unknown = null;
    listeners[0]!(
      { type: "FILL", credentials: { username: "alice", password: "s3cret" } },
      {},
      (r) => {
        response = r;
      },
    );
    (globalThis as any).document = null;

    expect(username.value).toBe("alice");
    expect(password.value).toBe("s3cret");
    expect(response).toEqual({ ok: true, filled: 2, username: true, password: true });
  });

  test("ignores non-FILL messages", async () => {
    const password = makeField({ type: "password", name: "password" });
    const doc = makeFakeDoc([password]);
    (globalThis as any).document = doc;

    let responded = false;
    listeners[0]!({ type: "OTHER" }, {}, () => {
      responded = true;
    });
    (globalThis as any).document = null;

    expect(responded).toBe(false);
    expect(password.value).toBe("");
  });
});
