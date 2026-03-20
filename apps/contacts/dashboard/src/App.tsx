import React, { useState, useEffect, useCallback } from "react";
import {
  fetchContacts,
  fetchCompanies,
  fetchTags,
  fetchStats,
  deleteContact,
} from "@/lib/api";
import type { ContactWithDetails, CompanyWithDetails, Tag, Stats } from "@/types";

type View = "contacts" | "companies" | "tags";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("contacts");
  const [contacts, setContacts] = useState<ContactWithDetails[]>([]);
  const [companies, setCompanies] = useState<CompanyWithDetails[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [contactsRes, companiesRes, tagsRes, statsRes] = await Promise.all([
        fetchContacts({ q: search || undefined, limit: 100 }),
        fetchCompanies({ q: search || undefined, limit: 100 }),
        fetchTags(),
        fetchStats(),
      ]);
      setContacts(contactsRes.contacts);
      setCompanies(companiesRes.companies);
      setTags(tagsRes);
      setStats(statsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDeleteContact = async (id: string) => {
    if (!confirm("Delete this contact?")) return;
    await deleteContact(id);
    await loadData();
  };

  const getInitials = (c: ContactWithDetails) => {
    const first = c.first_name?.[0] ?? "";
    const last = c.last_name?.[0] ?? "";
    return (first + last).toUpperCase() || "?";
  };

  const getDisplayName = (c: ContactWithDetails) => {
    if (c.first_name || c.last_name) {
      return [c.first_name, c.last_name].filter(Boolean).join(" ");
    }
    return c.emails?.[0]?.address ?? "Unknown";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <h1 className="text-xl font-bold">Open Contacts</h1>
          <input
            type="search"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm w-64"
          />
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <StatCard label="Contacts" value={stats.contacts} />
            <StatCard label="Companies" value={stats.companies} />
            <StatCard label="Tags" value={stats.tags} />
          </div>
        )}

        {/* Nav */}
        <div className="flex gap-1 mb-6 border-b">
          {(["contacts", "companies", "tags"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                view === v
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm mb-4">
            {error} — make sure the contacts server is running (<code>contacts serve</code>)
          </div>
        )}

        {loading ? (
          <div className="text-muted-foreground text-sm">Loading...</div>
        ) : view === "contacts" ? (
          <div className="space-y-2">
            {contacts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No contacts found.</p>
            ) : (
              contacts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm shrink-0">
                    {getInitials(c)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{getDisplayName(c)}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {c.emails?.[0]?.address ?? c.phones?.[0]?.number ?? c.job_title ?? ""}
                    </div>
                  </div>
                  {c.tags && c.tags.length > 0 && (
                    <div className="hidden sm:flex gap-1 flex-wrap">
                      {c.tags.slice(0, 3).map((t) => (
                        <span
                          key={t.id}
                          className="rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: (t.color ?? "#6366f1") + "20",
                            color: t.color ?? "#6366f1",
                          }}
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => handleDeleteContact(c.id)}
                    className="text-muted-foreground hover:text-destructive text-xs px-2 py-1 rounded"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        ) : view === "companies" ? (
          <div className="space-y-2">
            {companies.length === 0 ? (
              <p className="text-muted-foreground text-sm">No companies found.</p>
            ) : (
              companies.map((co) => (
                <div
                  key={co.id}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground font-semibold text-sm shrink-0">
                    {co.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{co.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {co.industry ?? co.website ?? ""}
                    </div>
                  </div>
                  {co.contacts && (
                    <div className="text-xs text-muted-foreground">
                      {co.contacts.length} contact{co.contacts.length !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.length === 0 ? (
              <p className="text-muted-foreground text-sm">No tags found.</p>
            ) : (
              tags.map((t) => (
                <span
                  key={t.id}
                  className="rounded-full px-3 py-1.5 text-sm font-medium"
                  style={{
                    backgroundColor: (t.color ?? "#6366f1") + "20",
                    color: t.color ?? "#6366f1",
                  }}
                >
                  {t.name}
                </span>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
