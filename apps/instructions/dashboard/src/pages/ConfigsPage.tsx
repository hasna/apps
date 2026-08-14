import { useEffect, useState } from "react";
import { api, type Config } from "../api";

const S = {
  row: { padding: "10px 14px", borderBottom: "1px solid #21262d", cursor: "pointer", display: "flex", gap: 12, alignItems: "center" } as React.CSSProperties,
  badge: (color: string) => ({ background: color, borderRadius: 4, padding: "2px 6px", fontSize: 11, color: "#fff" }) as React.CSSProperties,
  panel: { background: "#161b22", border: "1px solid #21262d", borderRadius: 8, padding: 20, flex: 1 } as React.CSSProperties,
  input: { background: "#21262d", border: "1px solid #30363d", borderRadius: 6, padding: "6px 10px", color: "#e6edf3", fontSize: 13, width: "100%" } as React.CSSProperties,
  select: { background: "#21262d", border: "1px solid #30363d", borderRadius: 6, padding: "6px 10px", color: "#e6edf3", fontSize: 13 } as React.CSSProperties,
  btn: (primary?: boolean) => ({ background: primary ? "#238636" : "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 13 }) as React.CSSProperties,
};

const CAT_COLORS: Record<string, string> = { agent: "#1f6feb", rules: "#388bfd", mcp: "#a371f7", shell: "#3fb950", secrets_schema: "#f85149", workspace: "#d29922", git: "#f0883e", tools: "#8b949e" };

export default function ConfigsPage() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [selected, setSelected] = useState<Config | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [msg, setMsg] = useState("");

  const load = async () => {
    const params: Record<string, string> = {};
    if (search) params["search"] = search;
    if (category) params["category"] = category;
    setConfigs(await api.configs.list(params));
  };

  useEffect(() => { load(); }, [search, category]);

  const save = async () => {
    if (!selected) return;
    await api.configs.update(selected.id, { content: editContent });
    setMsg("Saved!"); setEditing(false);
    const updated = await api.configs.get(selected.id);
    setSelected(updated); load();
    setTimeout(() => setMsg(""), 2000);
  };

  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 100px)" }}>
      <div style={{ width: 340, overflowY: "auto", background: "#161b22", border: "1px solid #21262d", borderRadius: 8 }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #21262d", display: "flex", flexDirection: "column", gap: 8 }}>
          <input style={S.input} placeholder="Search configs…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select style={S.select} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {["agent","rules","mcp","shell","secrets_schema","workspace","git","tools"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {configs.length === 0 && <div style={{ padding: 20, color: "#8b949e" }}>No configs found.</div>}
        {configs.map((c) => (
          <div key={c.id} style={{ ...S.row, background: selected?.id === c.id ? "#21262d" : "transparent" }} onClick={() => { setSelected(c); setEditing(false); setEditContent(c.content); }}>
            <span style={S.badge(CAT_COLORS[c.category] ?? "#8b949e")}>{c.category}</span>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ fontWeight: "bold", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
              <div style={{ color: "#8b949e", fontSize: 11 }}>{c.agent} · v{c.version} · {c.kind}</div>
            </div>
          </div>
        ))}
      </div>

      {selected ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={S.panel}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16 }}>{selected.name}</h2>
                <div style={{ color: "#8b949e", fontSize: 12, marginTop: 4 }}>
                  {selected.slug} · {selected.category} · {selected.agent} · {selected.kind} · v{selected.version}
                  {selected.target_path && <span> · <code style={{ color: "#58a6ff" }}>{selected.target_path}</code></span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {msg && <span style={{ color: "#3fb950", fontSize: 13, lineHeight: "30px" }}>{msg}</span>}
                {editing ? (
                  <>
                    <button style={S.btn(true)} onClick={save}>Save</button>
                    <button style={S.btn()} onClick={() => setEditing(false)}>Cancel</button>
                  </>
                ) : (
                  <button style={S.btn()} onClick={() => { setEditing(true); setEditContent(selected.content); }}>Edit</button>
                )}
              </div>
            </div>
            {editing ? (
              <textarea
                style={{ ...S.input, height: 400, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
            ) : (
              <pre style={{ background: "#0d1117", borderRadius: 6, padding: 14, overflow: "auto", maxHeight: 400, fontSize: 12, margin: 0 }}>{selected.content}</pre>
            )}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#8b949e" }}>
          Select a config to view
        </div>
      )}
    </div>
  );
}
