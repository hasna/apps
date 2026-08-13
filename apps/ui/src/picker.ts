/**
 * ui-local variant picker — a self-contained reimplementation of ui.sh's
 * `ui-picker.js`. Drop-in compatible: it reads the SAME markup contract
 * (`data-uidotsh-pick` on a wrapper, `data-uidotsh-option` on each option,
 * exactly one option visible, the rest `hidden`) so any UI generated for the
 * ui.sh workflow previews identically — but with zero remote dependency.
 *
 * Behaviour parity with the reference:
 *  - one decision group at a time (first `[data-uidotsh-pick]` in the document)
 *  - fixed bottom-center toolbar: prev | position+select | next
 *  - selecting an option toggles `hidden` + `display` on the option nodes
 *  - keyboard: ←/→ change option, ↑/↓ open the select (ignored while typing)
 *  - a MutationObserver re-syncs when the DOM changes
 *
 * Compiled to public/ui-picker.js via `bun build src/picker.ts --target browser`.
 */

const PICK_SEL = "[data-uidotsh-pick]";
const OPTION_SEL = "[data-uidotsh-option]";
const TAG = "uidotsh-picker";

interface Option {
  label: string;
  element: HTMLElement;
}
interface Group {
  label: string;
  options: Option[];
}

const labelOr = (raw: string | null, fallback: string): string => {
  const v = (raw ?? "").trim();
  return v.length > 0 ? v : fallback;
};

/** Read the first decision group and its direct options. */
function readGroup(): Group | null {
  const wrapper = document.querySelector(PICK_SEL);
  if (!wrapper) return null;
  const options: Option[] = [];
  let n = 0;
  for (const el of Array.from(wrapper.querySelectorAll(OPTION_SEL))) {
    if (el.closest(PICK_SEL) !== wrapper) continue; // only direct options of THIS group
    n += 1;
    options.push({
      label: labelOr(el.getAttribute("data-uidotsh-option"), `Option ${n}`),
      element: el as HTMLElement,
    });
  }
  return { label: labelOr(wrapper.getAttribute("data-uidotsh-pick"), "Decision 1"), options };
}

const visibleIndex = (g: Group): number => Math.max(0, g.options.findIndex((o) => !o.element.hidden));

/** Show exactly one option; hide the others. Returns true if anything changed. */
function selectOption(g: Group, choice?: Option): boolean {
  const target = choice ?? g.options.find((o) => !o.element.hidden) ?? g.options[0];
  if (!target) return false;
  let changed = false;
  for (const opt of g.options) {
    const hide = opt !== target;
    if (opt.element.hidden !== hide) {
      opt.element.hidden = hide;
      changed = true;
    }
    if (hide) opt.element.style.display = "none";
    else opt.element.style.removeProperty("display");
  }
  return changed;
}

const touchesPicker = (node: Node): boolean => {
  if (!(node instanceof Element)) return false;
  if (node.matches(PICK_SEL) || node.matches(OPTION_SEL)) return true;
  return node.querySelector(PICK_SEL) !== null || node.querySelector(OPTION_SEL) !== null;
};

const STYLES = `
  :host { display:block; position:fixed; width:0; height:0; overflow:visible;
    color:#fff; font-family:ui-sans-serif, system-ui, sans-serif; line-height:1; }
  *,*::before,*::after { box-sizing:border-box; }
  [data-popover] { display:block; position:fixed; left:50%; bottom:16px;
    transform:translateX(-50%); margin:0; padding:0; border:0; width:auto;
    max-width:calc(100vw - 16px); background:transparent; color:inherit;
    overflow:visible; outline:none; }
  [data-panel] { display:grid; grid-template-columns:auto auto 1fr auto auto;
    align-items:stretch; min-width:16rem; height:40px; border-radius:12px; padding:4px;
    background:rgba(10,10,10,0.8);
    box-shadow:0 0 0 1px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.1), 0 25px 50px -12px rgba(0,0,0,0.5);
    backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); }
  [data-nav] { width:32px; height:32px; border:0; border-radius:8px; display:inline-flex;
    align-items:center; justify-content:center; color:#a3a3a3; background:transparent; cursor:pointer;
    transition:color 120ms ease, background-color 120ms ease, opacity 120ms ease; }
  [data-nav]:hover, [data-nav]:focus-visible { color:#fff; background:rgba(255,255,255,0.1); outline:none; }
  [data-nav]:disabled { opacity:0.45; cursor:default; }
  [data-divider-wrap] { display:flex; align-items:center; padding:0 4px; }
  [data-divider] { width:1px; height:16px; background:rgba(255,255,255,0.12); }
  [data-center] { position:relative; min-width:0; border-radius:8px; display:flex; align-items:center;
    gap:8px; padding:0 8px; color:#fff; cursor:pointer; transition:background-color 120ms ease; }
  [data-center]:hover, [data-center]:focus-within { background:rgba(255,255,255,0.1); }
  [data-meta] { min-width:0; flex:1; display:flex; align-items:baseline; gap:8px; }
  [data-position] { flex-shrink:0; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size:12px; color:rgba(255,255,255,0.5); }
  [data-select] { min-width:0; flex:1; border:0; outline:none; color:#fff; background:transparent;
    appearance:none; font-size:13px; font-weight:500; text-align:center; white-space:nowrap;
    text-overflow:ellipsis; overflow:hidden; padding-right:18px; cursor:pointer; }
  [data-select]:disabled { cursor:default; color:rgba(255,255,255,0.6); }
  [data-chevron] { position:absolute; right:8px; width:14px; height:14px; color:#737373;
    pointer-events:none; transform:rotate(180deg); }
  [data-badge] { position:absolute; left:8px; top:-8px; font-size:9px; letter-spacing:0.04em;
    text-transform:uppercase; color:rgba(255,255,255,0.4); }
  @media (max-width:640px) {
    [data-popover] { left:8px; bottom:8px; transform:none; max-width:calc(100vw - 16px); }
    [data-panel] { min-width:calc(100vw - 16px); }
  }
`;

const MARKUP = `
  <div popover="manual" data-popover aria-label="UI picker (local)" tabindex="-1">
    <section data-panel>
      <button type="button" data-nav data-previous aria-label="Previous option">
        <svg viewBox="0 0 5 6" fill="currentColor" width="5" height="6" aria-hidden="true">
          <path d="M0.75 3L4.25 5.25L4.25 0.75L0.75 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
      </button>
      <div data-divider-wrap><div data-divider></div></div>
      <div data-center>
        <span data-meta>
          <span data-position>0/0</span>
          <select data-select aria-label="Select option"></select>
        </span>
        <svg viewBox="0 0 16 16" fill="currentColor" data-chevron aria-hidden="true">
          <path fill-rule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
        </svg>
      </div>
      <div data-divider-wrap><div data-divider></div></div>
      <button type="button" data-nav data-next aria-label="Next option">
        <svg viewBox="0 0 5 6" fill="currentColor" width="5" height="6" aria-hidden="true">
          <path d="M4.25 3L0.75 5.25L0.75 0.75L4.25 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
      </button>
    </section>
  </div>
`;

type SelectHandler = (opt: Option) => void;

class UidotshPicker extends HTMLElement {
  private root: ShadowRoot;
  private popover!: HTMLElement;
  private prevBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;
  private positionText!: HTMLElement;
  private select!: HTMLSelectElement;
  private group: Group | null = null;
  private onSelect: SelectHandler | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${STYLES}</style>${MARKUP}`;

    this.popover = this.root.querySelector("[data-popover]") as HTMLElement;
    this.prevBtn = this.root.querySelector("[data-previous]") as HTMLButtonElement;
    this.nextBtn = this.root.querySelector("[data-next]") as HTMLButtonElement;
    this.positionText = this.root.querySelector("[data-position]") as HTMLElement;
    this.select = this.root.querySelector("[data-select]") as HTMLSelectElement;
    const center = this.root.querySelector("[data-center]") as HTMLElement;

    this.prevBtn.addEventListener("click", () => this.move(-1));
    this.nextBtn.addEventListener("click", () => this.move(1));
    this.select.addEventListener("change", () => {
      const g = this.group;
      if (!g) return;
      const opt = g.options[this.select.selectedIndex];
      if (opt) this.onSelect?.(opt);
    });
    center.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.select.disabled) return;
      if (e.target instanceof Element && e.target.closest("select")) return;
      e.preventDefault();
      e.stopPropagation();
      this.openSelect();
    });
    this.popover.addEventListener("keydown", this.handleKey);
  }

  connectedCallback() {
    this.ensureVisible();
  }

  update(group: Group, onSelect: SelectHandler) {
    this.group = group;
    this.onSelect = onSelect;
    this.render(group);
    this.ensureVisible();
  }

  private isOpen(): boolean {
    try {
      return this.popover.matches(":popover-open");
    } catch {
      return this.popover.hasAttribute("data-open");
    }
  }

  ensureVisible() {
    if (this.isOpen()) return;
    try {
      (this.popover as any).showPopover?.();
    } catch {
      /* popover unsupported — fixed positioning keeps it visible anyway */
    }
    this.popover.setAttribute("data-open", "");
  }

  raiseToTop() {
    if (!this.isOpen()) {
      this.ensureVisible();
      return;
    }
    if (this.root.activeElement instanceof HTMLSelectElement) return;
    try {
      (this.popover as any).hidePopover?.();
      (this.popover as any).showPopover?.();
    } catch {
      /* no-op */
    }
  }

  private render(g: Group) {
    this.positionText.title = g.label;
    const many = g.options.length > 1;
    this.prevBtn.disabled = !many;
    this.nextBtn.disabled = !many;
    this.select.replaceChildren();

    if (g.options.length === 0) {
      const o = document.createElement("option");
      o.textContent = "No variations found";
      this.select.append(o);
      this.select.disabled = true;
      this.positionText.textContent = "0/0";
      return;
    }

    const idx = visibleIndex(g);
    this.positionText.textContent = `${idx + 1}/${g.options.length}`;
    for (const opt of g.options) {
      const o = document.createElement("option");
      o.textContent = opt.label;
      this.select.append(o);
    }
    this.select.disabled = false;
    this.select.selectedIndex = idx;
  }

  private move(delta: number) {
    const g = this.group;
    if (!g || g.options.length <= 1) return;
    const next = (visibleIndex(g) + delta + g.options.length) % g.options.length;
    const opt = g.options[next];
    if (opt) {
      this.onSelect?.(opt);
      this.popover.focus({ preventScroll: true });
    }
  }

  private openSelect() {
    if (this.select.disabled) return;
    this.select.focus({ preventScroll: true });
    const s = this.select as HTMLSelectElement & { showPicker?: () => void };
    if (s.showPicker) {
      try {
        s.showPicker();
        return;
      } catch {
        /* fall through */
      }
    }
    this.select.click();
  }

  handleKey = (e: KeyboardEvent) => {
    if (!this.group || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !(this.root.activeElement instanceof HTMLSelectElement)) {
      e.preventDefault();
      this.openSelect();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      this.move(e.key === "ArrowRight" ? 1 : -1);
    }
  };
}

function typingInField(node: EventTarget | null): boolean {
  return (
    node instanceof Element &&
    node.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
  );
}

function boot() {
  const w = window as unknown as { __uidotshPickerLoaded?: boolean };
  if (w.__uidotshPickerLoaded) return;
  w.__uidotshPickerLoaded = true;

  if (!customElements.get(TAG)) customElements.define(TAG, UidotshPicker);

  let picker: UidotshPicker | null = null;
  let scheduled = false;

  const place = () => {
    if (!picker) return;
    const host = document.body ?? document.documentElement;
    if (!picker.isConnected || picker.parentElement !== host) host.append(picker);
  };

  const sync = () => {
    const group = readGroup();
    if (!group) {
      picker?.remove();
      picker = null;
      return;
    }
    selectOption(group); // enforce exactly-one-visible
    if (!picker) picker = document.createElement(TAG) as UidotshPicker;
    place();
    picker.update(group, (opt) => {
      if (selectOption(group, opt)) sync();
    });
  };

  const scheduleSync = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sync();
    });
  };

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") {
        if (touchesPicker(r.target)) return scheduleSync();
        continue;
      }
      for (const n of Array.from(r.addedNodes)) if (touchesPicker(n)) return scheduleSync();
      for (const n of Array.from(r.removedNodes)) if (touchesPicker(n)) return scheduleSync();
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-uidotsh-pick", "data-uidotsh-option", "hidden"],
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (!picker) return;
      if (e.target instanceof Node && picker.contains(e.target)) return;
      if (typingInField(e.target) || typingInField(document.activeElement)) return;
      picker.handleKey(e);
    },
    true,
  );

  sync();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
