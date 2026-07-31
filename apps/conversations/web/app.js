/* Hasna Conversations — web UI controller.
   Talks to the same-origin dashboard API (/api/*) served by src/server/serve.ts.
   Boot config is injected by the native shell as window.__BOOT__ (optional). */

(() => {
  "use strict";

  const BOOT = (typeof window !== "undefined" && window.__BOOT__) || {};
  const API = (BOOT.apiBase || "").replace(/\/$/, "");
  const ME = (BOOT.agentId || "user").trim() || "user";

  const PAGES = [
    { id: "home", glyph: "⌂", label: "Home" },
    { id: "threads", glyph: "💬", label: "Threads" },
    { id: "activity", glyph: "❖", label: "Activity" },
  ];

  const state = {
    channels: [],
    sessions: [],
    /** active: {kind:'channel'|'dm'|'page', id, name, session, topic} */
    active: null,
    messages: [],
    lastRenderKey: "",
  };

  // ---- DOM helpers ----
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const dom = {
    pages: $("#pages"),
    channelList: $("#channelList"),
    dmList: $("#dmList"),
    messages: $("#messages"),
    emptyState: $("#emptyState"),
    chTitle: $("#chTitle"),
    chTopic: $("#chTopic"),
    composerWrap: $("#composerWrap"),
    composer: $("#composer"),
    composerInput: $("#composerInput"),
    sendBtn: $("#sendBtn"),
    canvas: $("#canvas"),
    meName: $("#meName"),
    meAvatar: $("#meAvatar"),
  };

  // ---- color hashing for avatars ----
  const AV_COLORS = ["#7C3AED", "#2563EB", "#059669", "#D97706", "#DB2777",
    "#0891B2", "#65A30D", "#DC2626", "#7C3AED", "#4F46E5"];
  function colorFor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  }
  function initials(name) {
    const parts = String(name || "?").replace(/[^a-zA-Z0-9 ]/g, "").trim().split(/[\s\-_]+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]);
    return String(name || "?").slice(0, 2);
  }
  function avatarNode(name, cls) {
    const a = el("span", "avatar" + (cls ? " " + cls : ""), initials(name));
    a.style.background = colorFor(name || "?");
    return a;
  }

  // ---- API ----
  async function api(path, opts) {
    const res = await fetch(API + path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("json") ? res.json() : res.text();
  }

  function toast(msg, isErr) {
    const host = $("#toastHost");
    const t = el("div", "toast" + (isErr ? " err" : ""), msg);
    host.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  // ---- time formatting ----
  function fmtTime(iso) {
    const d = new Date(iso.includes("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z");
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  function dayKey(iso) {
    const d = new Date(iso.includes("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z");
    return d.toDateString();
  }
  function fmtDay(iso) {
    const d = new Date(iso.includes("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z");
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }

  // ---- session helpers ----
  function isChannelSession(s) { return String(s.session_id || "").startsWith("channel:"); }
  function dmPartner(s) {
    const others = (s.participants || []).filter((p) => p !== ME);
    return others[0] || (s.participants || [])[0] || "unknown";
  }

  // ---- rendering: sidebar ----
  function renderPages() {
    dom.pages.innerHTML = "";
    for (const p of PAGES) {
      const row = el("div", "row page-row");
      row.dataset.page = p.id;
      row.appendChild(el("span", "glyph", p.glyph));
      row.appendChild(el("span", "label", p.label));
      if (state.active && state.active.kind === "page" && state.active.id === p.id) row.classList.add("active");
      row.addEventListener("click", () => selectPage(p));
      dom.pages.appendChild(row);
    }
  }

  function renderChannels() {
    dom.channelList.innerHTML = "";
    const list = state.channels.filter((c) => !c.archived_at);
    if (!list.length) {
      const hint = el("div", "row"); hint.style.opacity = ".5";
      hint.appendChild(el("span", "label", "No channels yet"));
      dom.channelList.appendChild(hint);
    }
    for (const c of list) {
      const row = el("div", "row");
      row.appendChild(el("span", "glyph", "#"));
      row.appendChild(el("span", "label", c.name));
      if (state.active && state.active.kind === "channel" && state.active.id === c.name) row.classList.add("active");
      row.addEventListener("click", () => selectChannel(c));
      dom.channelList.appendChild(row);
    }
  }

  function renderDMs() {
    dom.dmList.innerHTML = "";
    const dms = state.sessions.filter((s) => !isChannelSession(s));
    if (!dms.length) {
      const hint = el("div", "row"); hint.style.opacity = ".5";
      hint.appendChild(el("span", "label", "No direct messages"));
      dom.dmList.appendChild(hint);
    }
    for (const s of dms) {
      const partner = dmPartner(s);
      const row = el("div", "row");
      row.appendChild(avatarNode(partner, "sm"));
      row.appendChild(el("span", "label", partner));
      if (s.unread_count > 0) {
        row.classList.add("unread");
        row.appendChild(el("span", "badge", String(s.unread_count)));
      }
      if (state.active && state.active.kind === "dm" && state.active.session === s.session_id) row.classList.add("active");
      row.addEventListener("click", () => selectDM(s));
      dom.dmList.appendChild(row);
    }
  }

  // ---- selection ----
  function selectPage(p) {
    state.active = { kind: "page", id: p.id, name: p.label };
    dom.chTitle.textContent = p.label;
    dom.chTopic.textContent = "";
    dom.composerWrap.hidden = true;
    state.messages = [];
    state.lastRenderKey = "";
    if (p.id === "threads") loadThreads();
    else if (p.id === "activity") loadActivity();
    else loadHome();
    refreshSidebarActive();
  }

  function selectChannel(c) {
    state.active = { kind: "channel", id: c.name, name: "# " + c.name, topic: c.topic || c.description || "", session: "channel:" + c.name };
    dom.chTitle.textContent = "# " + c.name;
    dom.chTopic.textContent = c.topic || c.description || "";
    dom.composerWrap.hidden = false;
    dom.composerInput.placeholder = "Message #" + c.name;
    state.messages = [];
    state.lastRenderKey = "";
    loadMessages();
    refreshSidebarActive();
  }

  function selectDM(s) {
    const partner = dmPartner(s);
    state.active = { kind: "dm", id: partner, name: partner, session: s.session_id, topic: "" };
    dom.chTitle.textContent = partner;
    dom.chTopic.textContent = "Direct message";
    dom.composerWrap.hidden = false;
    dom.composerInput.placeholder = "Message " + partner;
    state.messages = [];
    state.lastRenderKey = "";
    loadMessages();
    refreshSidebarActive();
  }

  function refreshSidebarActive() {
    renderPages();
    renderChannels();
    renderDMs();
  }

  // ---- message loading ----
  function activeQuery() {
    if (!state.active) return null;
    if (state.active.kind === "channel") return "/api/messages?channel=" + encodeURIComponent(state.active.id) + "&limit=200";
    if (state.active.kind === "dm") return "/api/messages?session=" + encodeURIComponent(state.active.session) + "&limit=200";
    return null;
  }

  async function loadMessages() {
    const q = activeQuery();
    if (!q) return;
    try {
      const msgs = await api(q);
      // API returns desc; show ascending
      state.messages = Array.isArray(msgs) ? msgs.slice().reverse() : [];
      renderMessages();
    } catch (e) {
      toast("Load failed: " + e.message, true);
    }
  }

  async function loadHome() {
    try {
      const msgs = await api("/api/messages?limit=100");
      state.messages = Array.isArray(msgs) ? msgs.slice().reverse() : [];
      dom.chTopic.textContent = "Recent activity across all conversations";
      renderMessages(true);
    } catch (e) { toast("Load failed: " + e.message, true); }
  }
  async function loadActivity() {
    try {
      const st = await api("/api/status");
      renderStats(st);
    } catch (e) { toast("Load failed: " + e.message, true); }
  }
  async function loadThreads() {
    try {
      const msgs = await api("/api/messages/pinned?limit=100");
      state.messages = Array.isArray(msgs) ? msgs.slice().reverse() : [];
      dom.chTopic.textContent = "Pinned messages";
      renderMessages(true);
    } catch (e) { toast("Load failed: " + e.message, true); }
  }

  function renderStats(st) {
    dom.messages.innerHTML = "";
    const wrap = el("div", "empty-state");
    const rows = [
      ["Messages", st.total_messages],
      ["Sessions", st.total_sessions],
      ["Channels", st.total_channels],
      ["Projects", st.total_projects],
      ["Unread", st.unread_messages],
    ];
    const grid = el("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:12px;margin:0 auto;text-align:left";
    for (const [k, v] of rows) {
      const card = el("div");
      card.style.cssText = "border:.5px solid var(--hair);border-radius:var(--r-panel);padding:14px 18px";
      const num = el("div", null, String(v ?? 0));
      num.style.cssText = "font-size:24px;font-weight:700;color:var(--fg)";
      const lbl = el("div", null, k);
      lbl.style.cssText = "font-size:11px;color:var(--grey);text-transform:uppercase;letter-spacing:.04em";
      card.appendChild(num); card.appendChild(lbl);
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    dom.messages.appendChild(wrap);
  }

  function renderMessages(showChannelTag) {
    const key = state.messages.map((m) => m.id + ":" + (m.content || "").length).join(",");
    const atBottom = dom.messages.scrollHeight - dom.messages.scrollTop - dom.messages.clientHeight < 80;
    if (key === state.lastRenderKey) return;
    state.lastRenderKey = key;

    dom.messages.innerHTML = "";
    if (!state.messages.length) {
      const es = el("div", "empty-state");
      es.appendChild(el("div", "empty-glyph", "✳︎"));
      es.appendChild(el("div", "empty-text", "No messages yet. Say hello."));
      dom.messages.appendChild(es);
      return;
    }

    let lastAuthor = null, lastDay = null, lastTs = 0;
    for (const m of state.messages) {
      const dk = dayKey(m.created_at);
      if (dk !== lastDay) {
        const sep = el("div", "day-sep");
        sep.appendChild(el("span", null, fmtDay(m.created_at)));
        dom.messages.appendChild(sep);
        lastDay = dk;
        lastAuthor = null;
      }
      const ts = new Date(m.created_at.replace(" ", "T")).getTime();
      const grouped = m.from_agent === lastAuthor && (ts - lastTs) < 5 * 60 * 1000;
      lastAuthor = m.from_agent; lastTs = ts;

      const row = el("div", "msg" + (grouped ? " grouped" : "") + (m.from_agent === ME ? " mine" : ""));
      if (m.priority === "high") row.classList.add("prio-high");
      if (m.priority === "urgent") row.classList.add("prio-urgent");

      const gutter = el("div", "gutter");
      if (!grouped) gutter.appendChild(avatarNode(m.from_agent));
      row.appendChild(gutter);

      const body = el("div", "body");
      if (!grouped) {
        const meta = el("div", "meta");
        let author = m.from_agent;
        if (showChannelTag && m.channel) author += "  ›  #" + m.channel;
        meta.appendChild(el("span", "author", author));
        meta.appendChild(el("span", "time", fmtTime(m.created_at)));
        body.appendChild(meta);
      }
      const text = el("div", "text");
      text.appendChild(renderContent(m.content || ""));
      body.appendChild(text);
      row.appendChild(body);
      dom.messages.appendChild(row);
    }

    if (atBottom || showChannelTag) dom.messages.scrollTop = dom.messages.scrollHeight;
  }

  // minimal inline formatting: `code` spans; everything else escaped as text
  function renderContent(txt) {
    const frag = document.createDocumentFragment();
    const parts = txt.split(/(`[^`]+`)/g);
    for (const part of parts) {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        frag.appendChild(el("code", null, part.slice(1, -1)));
      } else if (part) {
        frag.appendChild(document.createTextNode(part));
      }
    }
    return frag;
  }

  // ---- sending ----
  async function send() {
    const content = dom.composerInput.value.trim();
    if (!content || !state.active) return;
    const a = state.active;
    let payload;
    if (a.kind === "channel") payload = { from: ME, to: a.id, content, channel: a.id };
    else if (a.kind === "dm") payload = { from: ME, to: a.id, content };
    else return;

    dom.composerInput.value = "";
    autosize();
    try {
      await api("/api/messages", { method: "POST", body: JSON.stringify(payload) });
      await loadMessages();
      dom.messages.scrollTop = dom.messages.scrollHeight;
    } catch (e) {
      toast("Send failed: " + e.message, true);
      dom.composerInput.value = content;
    }
  }

  function autosize() {
    const ta = dom.composerInput;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
    dom.sendBtn.disabled = !ta.value.trim();
  }

  // ---- create channel / new DM ----
  async function createChannel() {
    const name = window.prompt("New channel name (lowercase, no spaces):");
    if (!name) return;
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9\-_]/g, "-");
    if (!clean) return;
    try {
      await api("/api/channels", { method: "POST", body: JSON.stringify({ name: clean, created_by: ME }) });
      await refreshData();
      const c = state.channels.find((x) => x.name === clean);
      if (c) selectChannel(c);
      toast("Created #" + clean);
    } catch (e) { toast("Create failed: " + e.message, true); }
  }

  function newDM() {
    const who = window.prompt("Message which agent? (name)");
    if (!who) return;
    const partner = who.trim();
    if (!partner) return;
    // synthesize a session locally; it materializes once a message is sent
    const existing = state.sessions.find((s) => !isChannelSession(s) && dmPartner(s) === partner);
    if (existing) { selectDM(existing); return; }
    state.active = { kind: "dm", id: partner, name: partner, session: "", topic: "" };
    dom.chTitle.textContent = partner;
    dom.chTopic.textContent = "Direct message";
    dom.composerWrap.hidden = false;
    dom.composerInput.placeholder = "Message " + partner;
    state.messages = []; state.lastRenderKey = "x";
    renderMessages();
    dom.composerInput.focus();
  }

  // ---- data refresh ----
  async function refreshData() {
    try {
      const [channels, sessions] = await Promise.all([
        api("/api/channels"),
        api("/api/sessions?agent=" + encodeURIComponent(ME)),
      ]);
      state.channels = Array.isArray(channels) ? channels : [];
      state.sessions = Array.isArray(sessions) ? sessions : [];
      renderChannels();
      renderDMs();
    } catch (e) {
      // silent on background refresh; surface on first load
      if (!state.channels.length && !state.sessions.length) toast("Cannot reach server: " + e.message, true);
    }
  }

  // ---- theme ----
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("hc-theme", t); } catch (_) {}
  }
  function initTheme() {
    let t = null;
    try { t = localStorage.getItem("hc-theme"); } catch (_) {}
    if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyTheme(t);
  }

  // ---- scroll edge state ----
  function wireScrollEdge() {
    dom.messages.addEventListener("scroll", () => {
      dom.canvas.classList.toggle("scrolled", dom.messages.scrollTop > 4);
    });
    for (const sc of document.querySelectorAll(".scroller")) {
      let tmr;
      sc.addEventListener("scroll", () => {
        sc.classList.add("scrolling");
        clearTimeout(tmr);
        tmr = setTimeout(() => sc.classList.remove("scrolling"), 700);
      });
    }
  }

  // ---- events ----
  function wire() {
    dom.composer.addEventListener("submit", (e) => { e.preventDefault(); send(); });
    dom.composerInput.addEventListener("input", autosize);
    dom.composerInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $("#addChannelBtn").addEventListener("click", (e) => { e.stopPropagation(); createChannel(); });
    $("#addDmBtn").addEventListener("click", (e) => { e.stopPropagation(); newDM(); });
    $("#themeToggle").addEventListener("click", () => {
      applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
    for (const head of document.querySelectorAll(".sb-section-head")) {
      head.addEventListener("click", (e) => {
        if (e.target.classList.contains("sb-add")) return;
        const sec = head.closest(".sb-section");
        sec.classList.toggle("collapsed");
        head.setAttribute("aria-expanded", String(!sec.classList.contains("collapsed")));
      });
    }
  }

  // ---- boot ----
  function boot() {
    if (BOOT.native) document.body.classList.add("native");
    dom.meName.textContent = ME;
    dom.meAvatar.textContent = initials(ME);
    dom.meAvatar.style.background = colorFor(ME);
    initTheme();
    renderPages();
    wire();
    wireScrollEdge();
    autosize();
    refreshData().then(() => {
      // default: first channel, else Home
      const firstChan = state.channels.filter((c) => !c.archived_at)[0];
      if (firstChan) selectChannel(firstChan);
      else selectPage(PAGES[0]);
    });

    // polling
    setInterval(() => {
      if (state.active && (state.active.kind === "channel" || state.active.kind === "dm") && state.active.session) {
        loadMessages();
      }
    }, 1500);
    setInterval(refreshData, 5000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
