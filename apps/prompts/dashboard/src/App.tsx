import { useState, useEffect, useRef } from "react"
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Search, Plus, BookOpen, Layers, BarChart2, Copy, Check, Tag, Edit2, Trash2, Play, FolderOpen } from "lucide-react"
import { api } from "./api"
import type { Prompt, Collection, Project } from "./api"
import "./App.css"

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  )
}

type View = "prompts" | "templates" | "stats"

function Dashboard() {
  const [view, setView] = useState<View>("prompts")
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const { data: collections = [] } = useQuery({
    queryKey: ["collections"],
    queryFn: () => api.listCollections(),
  })

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  })

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === "INPUT" || tag === "TEXTAREA"
      if (e.key === "/" && !isInput) { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === "n" && !isInput) { e.preventDefault(); setShowCreate(true) }
      if (e.key === "Escape") { setSelectedPrompt(null); setShowCreate(false); searchRef.current?.blur() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="app">
      <Sidebar
        view={view}
        setView={setView}
        collections={collections}
        selectedCollection={selectedCollection}
        setSelectedCollection={(c) => { setSelectedCollection(c); setSelectedProject(null) }}
        projects={projects}
        selectedProject={selectedProject}
        setSelectedProject={(p) => { setSelectedProject(p); setSelectedCollection(null) }}
      />
      <main className="main">
        <Header
          search={search}
          setSearch={setSearch}
          onNew={() => setShowCreate(true)}
          view={view}
          inputRef={searchRef}
        />
        {view === "stats" ? (
          <StatsView />
        ) : (
          <PromptList
            view={view}
            search={search}
            collection={selectedCollection}
            project={selectedProject}
            onSelect={setSelectedPrompt}
            selected={selectedPrompt}
          />
        )}
      </main>
      {selectedPrompt && (
        <PromptDetail
          prompt={selectedPrompt}
          onClose={() => setSelectedPrompt(null)}
          onUpdated={(p) => setSelectedPrompt(p)}
        />
      )}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}

function Sidebar({ view, setView, collections, selectedCollection, setSelectedCollection, projects, selectedProject, setSelectedProject }: {
  view: View
  setView: (v: View) => void
  collections: Collection[]
  selectedCollection: string | null
  setSelectedCollection: (c: string | null) => void
  projects: Project[]
  selectedProject: string | null
  setSelectedProject: (p: string | null) => void
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <BookOpen size={20} />
        <span>open-prompts</span>
      </div>
      <nav className="sidebar-nav">
        <button className={`nav-item ${view === "prompts" ? "active" : ""}`} onClick={() => { setView("prompts"); setSelectedCollection(null); setSelectedProject(null) }}>
          <BookOpen size={16} /> All Prompts
        </button>
        <button className={`nav-item ${view === "templates" ? "active" : ""}`} onClick={() => { setView("templates"); setSelectedCollection(null); setSelectedProject(null) }}>
          <Layers size={16} /> Templates
        </button>
        <button className={`nav-item ${view === "stats" ? "active" : ""}`} onClick={() => setView("stats")}>
          <BarChart2 size={16} /> Stats
        </button>
      </nav>
      {projects.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">Projects</div>
          {projects.map((p) => (
            <button
              key={p.id}
              className={`nav-item collection-item ${selectedProject === p.id ? "active" : ""}`}
              onClick={() => { setSelectedProject(p.id === selectedProject ? null : p.id); setView("prompts") }}
            >
              <FolderOpen size={14} />
              <span>{p.name}</span>
              <span className="collection-count">{p.prompt_count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Collections</div>
        {collections.map((c) => (
          <button
            key={c.id}
            className={`nav-item collection-item ${selectedCollection === c.name ? "active" : ""}`}
            onClick={() => { setSelectedCollection(c.name === selectedCollection ? null : c.name); setView("prompts") }}
          >
            <span className="collection-dot" />
            <span>{c.name}</span>
            <span className="collection-count">{c.prompt_count}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}

function Header({ search, setSearch, onNew, view, inputRef }: {
  search: string
  setSearch: (s: string) => void
  onNew: () => void
  view: View
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="header">
      <div className="search-bar">
        <Search size={16} />
        <input
          ref={inputRef}
          placeholder='Search prompts… (press / to focus)'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {view !== "stats" && (
        <button className="btn-primary" onClick={onNew}>
          <Plus size={16} /> New Prompt
        </button>
      )}
    </div>
  )
}

function PromptList({ view, search, collection, project, onSelect, selected }: {
  view: View
  search: string
  collection: string | null
  project: string | null
  onSelect: (p: Prompt) => void
  selected: Prompt | null
}) {
  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ["search", search, collection, project],
    queryFn: () => api.search(search, {
      ...(collection ? { collection } : {}),
      ...(project ? { project } : {}),
    }),
    enabled: search.length > 0,
  })

  const { data: prompts = [], isLoading } = useQuery({
    queryKey: ["prompts", collection, project, view],
    queryFn: () => api.listPrompts({
      ...(collection ? { collection } : {}),
      ...(project ? { project } : {}),
      ...(view === "templates" ? { templates: "1" } : {}),
      limit: "200",
    }),
    enabled: search.length === 0,
  })

  const items: Prompt[] = search.length > 0
    ? (searchResults ?? []).map((r) => r.prompt)
    : prompts

  if (isLoading || searching) return <div className="loading">Loading...</div>
  if (items.length === 0) return <div className="empty">No prompts found.</div>

  return (
    <div className="prompt-list">
      {items.map((p) => (
        <PromptCard key={p.id} prompt={p} selected={selected?.id === p.id} onSelect={onSelect} />
      ))}
    </div>
  )
}

function PromptCard({ prompt, selected, onSelect }: { prompt: Prompt; selected: boolean; onSelect: (p: Prompt) => void }) {
  const [showQuickRender, setShowQuickRender] = useState(false)
  const [vars, setVars] = useState<Record<string, string>>({})
  const [rendered, setRendered] = useState<string | null>(null)

  const renderMutation = useMutation({
    mutationFn: () => api.renderPrompt(prompt.id, vars),
    onSuccess: (r) => { setRendered(r.rendered); void navigator.clipboard.writeText(r.rendered) },
  })

  return (
    <div className={`prompt-card ${selected ? "selected" : ""}`}>
      <div onClick={() => onSelect(prompt)}>
        <div className="prompt-card-header">
          <span className="prompt-id">{prompt.id}</span>
          {prompt.is_template && <span className="badge template">template</span>}
          {(prompt as Prompt & { pinned?: boolean }).pinned && <span title="Pinned">📌</span>}
          {prompt.project_id && <span className="badge project"><FolderOpen size={10} />project</span>}
          <span className="badge collection">{prompt.collection}</span>
        </div>
        <div className="prompt-title">{prompt.title}</div>
        {prompt.description && <div className="prompt-desc">{prompt.description}</div>}
        <div className="prompt-footer">
          {prompt.tags.map((t) => (
            <span key={t} className="tag"><Tag size={10} />{t}</span>
          ))}
          <span className="use-count"><Play size={10} />{prompt.use_count}×</span>
          {prompt.is_template && (
            <button
              className="quick-render-btn"
              title="Quick render template"
              onClick={(e) => { e.stopPropagation(); setShowQuickRender(!showQuickRender); setRendered(null) }}
            >
              <Play size={12} /> Fill
            </button>
          )}
        </div>
      </div>

      {showQuickRender && prompt.is_template && (
        <div className="quick-render" onClick={(e) => e.stopPropagation()}>
          {prompt.variables.map((v) => (
            <label key={v.name}>
              <span>{v.name}{(v as typeof v & { required?: boolean }).required ? " *" : ""}</span>
              <input
                placeholder={v.default ?? ""}
                value={vars[v.name] ?? ""}
                onChange={(e) => setVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
              />
            </label>
          ))}
          <div className="quick-render-actions">
            <button className="btn-primary" onClick={() => renderMutation.mutate()}>
              {renderMutation.isPending ? "…" : <><Copy size={12} /> Copy</>}
            </button>
            {rendered && <span className="muted">Copied!</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function PromptDetail({ prompt, onClose, onUpdated }: {
  prompt: Prompt
  onClose: () => void
  onUpdated: (p: Prompt) => void
}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<"body" | "render" | "history">("body")
  const [copied, setCopied] = useState(false)
  const [renderVars, setRenderVars] = useState<Record<string, string>>({})
  const [renderResult, setRenderResult] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(prompt.body)

  const { data: history = [] } = useQuery({
    queryKey: ["history", prompt.id],
    queryFn: () => api.getHistory(prompt.id),
    enabled: tab === "history",
  })

  const updateMutation = useMutation({
    mutationFn: (body: string) => api.updatePrompt(prompt.id, { body }),
    onSuccess: (updated) => { onUpdated(updated); setEditing(false); void qc.invalidateQueries({ queryKey: ["prompts"] }) },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deletePrompt(prompt.id),
    onSuccess: () => { onClose(); void qc.invalidateQueries({ queryKey: ["prompts"] }) },
  })

  const renderMutation = useMutation({
    mutationFn: () => api.renderPrompt(prompt.id, renderVars),
    onSuccess: (r) => setRenderResult(r.rendered),
  })

  function copyBody() {
    void navigator.clipboard.writeText(prompt.body)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <aside className="detail">
      <div className="detail-header">
        <div>
          <div className="detail-id">{prompt.id}</div>
          <div className="detail-title">{prompt.title}</div>
          <div className="detail-slug">/{prompt.slug}</div>
        </div>
        <div className="detail-actions">
          <button title="Copy body" onClick={copyBody}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button title="Edit body" onClick={() => { setEditing(!editing); setEditBody(prompt.body) }}>
            <Edit2 size={16} />
          </button>
          <button title="Delete" className="danger" onClick={() => { if (confirm("Delete this prompt?")) deleteMutation.mutate() }}>
            <Trash2 size={16} />
          </button>
          <button onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="detail-meta">
        <span className="badge collection">{prompt.collection}</span>
        {prompt.is_template && <span className="badge template">template</span>}
        <span className="badge source">{prompt.source}</span>
        {prompt.tags.map((t) => <span key={t} className="tag"><Tag size={10} />{t}</span>)}
      </div>

      <div className="tabs">
        {(["body", "render", "history"] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "body" && (
        <div className="tab-content">
          {editing ? (
            <>
              <textarea
                className="body-editor"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
              />
              <div className="edit-actions">
                <button className="btn-primary" onClick={() => updateMutation.mutate(editBody)}>Save</button>
                <button onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </>
          ) : (
            <pre className="body-text">{prompt.body}</pre>
          )}
          {prompt.is_template && (
            <div className="vars-section">
              <strong>Variables:</strong>
              {prompt.variables.map((v) => (
                <span key={v.name} className={`var-badge ${v.required ? "required" : "optional"}`}>
                  {`{{${v.name}${v.default ? `|${v.default}` : ""}}}`}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "render" && (
        <div className="tab-content">
          {prompt.variables.length === 0 ? (
            <p className="muted">This prompt has no template variables.</p>
          ) : (
            <>
              <div className="render-vars">
                {prompt.variables.map((v) => (
                  <label key={v.name}>
                    <span>{v.name}{v.required ? " *" : ""}</span>
                    <input
                      placeholder={v.default ?? ""}
                      value={renderVars[v.name] ?? ""}
                      onChange={(e) => setRenderVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <button className="btn-primary" onClick={() => renderMutation.mutate()}>Render</button>
              {renderResult && (
                <>
                  <pre className="body-text rendered">{renderResult}</pre>
                  <button onClick={() => { void navigator.clipboard.writeText(renderResult) }}>
                    <Copy size={14} /> Copy
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="tab-content">
          {history.map((v) => (
            <div key={v.id} className="version-item">
              <div className="version-header">
                <strong>v{v.version}</strong>
                <span className="muted">{new Date(v.created_at).toLocaleString()}</span>
                {v.changed_by && <span className="muted">by {v.changed_by}</span>}
                {v.version === prompt.version && <span className="badge template">current</span>}
              </div>
              <pre className="body-preview">{v.body.slice(0, 200)}{v.body.length > 200 ? "..." : ""}</pre>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [collection, setCollection] = useState("default")
  const [tags, setTags] = useState("")
  const [description, setDescription] = useState("")

  const mutation = useMutation({
    mutationFn: () => api.createPrompt({ title, body, collection, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), description: description || undefined }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["prompts"] }); void qc.invalidateQueries({ queryKey: ["collections"] }); onClose() },
  })

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h2>New Prompt</h2>
        <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. TypeScript Code Review" /></label>
        <label>Body <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Prompt content. Use {{variable}} for templates." rows={8} /></label>
        <label>Description <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" /></label>
        <label>Collection <input value={collection} onChange={(e) => setCollection(e.target.value)} /></label>
        <label>Tags <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma, separated, tags" /></label>
        <div className="modal-actions">
          <button className="btn-primary" onClick={() => mutation.mutate()} disabled={!title || !body || mutation.isPending}>
            {mutation.isPending ? "Saving..." : "Save Prompt"}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
        {mutation.isError && <div className="error">{mutation.error.message}</div>}
      </div>
    </div>
  )
}

function StatsView() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.getStats(),
  })

  if (isLoading) return <div className="loading">Loading stats...</div>
  if (!stats) return null

  return (
    <div className="stats-view">
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-num">{stats.total_prompts}</div><div className="stat-label">Total Prompts</div></div>
        <div className="stat-card"><div className="stat-num">{stats.total_templates}</div><div className="stat-label">Templates</div></div>
        <div className="stat-card"><div className="stat-num">{stats.total_collections}</div><div className="stat-label">Collections</div></div>
      </div>
      {stats.most_used.length > 0 && (
        <div className="stats-section">
          <h3>Most Used</h3>
          {stats.most_used.map((p) => (
            <div key={p.id} className="stat-row">
              <span className="slug">{p.slug}</span>
              <span className="use-count">{p.use_count}×</span>
            </div>
          ))}
        </div>
      )}
      {stats.by_collection.length > 0 && (
        <div className="stats-section">
          <h3>By Collection</h3>
          {stats.by_collection.map((c) => (
            <div key={c.collection} className="stat-row">
              <span>{c.collection}</span>
              <span>{c.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
