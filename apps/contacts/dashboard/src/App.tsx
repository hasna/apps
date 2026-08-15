import * as React from "react";
import { RefreshCwIcon, UsersIcon, BuildingIcon, TagIcon, ArrowUpDownIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { ContactList } from "@/components/contact-list";
import { ContactDetail } from "@/components/contact-detail";
import { ContactForm } from "@/components/contact-form";
import { CompanyList } from "@/components/company-list";
import { CompanyDetail } from "@/components/company-detail";
import { CompanyForm } from "@/components/company-form";
import { TagList } from "@/components/tag-list";
import { ImportExport } from "@/components/import-export";
import { Button } from "@/components/ui/button";
import {
  fetchContacts,
  fetchCompanies,
  fetchTags,
  fetchStats,
  createContact,
  updateContact,
  deleteContact as apiDeleteContact,
  createCompany,
  updateCompany,
  deleteCompany as apiDeleteCompany,
  createTag as apiCreateTag,
  deleteTag as apiDeleteTag,
  importContacts,
} from "@/lib/api";
import type { ContactWithDetails, CompanyWithDetails, Tag, Stats } from "@/types";

type Page = "contacts" | "companies" | "tags" | "import";

export default function App() {
  const [page, setPage] = React.useState<Page>("contacts");
  const [contacts, setContacts] = React.useState<ContactWithDetails[]>([]);
  const [contactTotal, setContactTotal] = React.useState(0);
  const [companies, setCompanies] = React.useState<CompanyWithDetails[]>([]);
  const [companyTotal, setCompanyTotal] = React.useState(0);
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [stats, setStats] = React.useState<Stats>({ contacts: 0, companies: 0, tags: 0 });
  const [loading, setLoading] = React.useState(true);
  const [contactSearch, setContactSearch] = React.useState("");
  const [companySearch, setCompanySearch] = React.useState("");
  const [selectedContact, setSelectedContact] = React.useState<ContactWithDetails | null>(null);
  const [selectedCompany, setSelectedCompany] = React.useState<CompanyWithDetails | null>(null);
  const [contactFormOpen, setContactFormOpen] = React.useState(false);
  const [editingContact, setEditingContact] = React.useState<ContactWithDetails | null>(null);
  const [companyFormOpen, setCompanyFormOpen] = React.useState(false);
  const [editingCompany, setEditingCompany] = React.useState<CompanyWithDetails | null>(null);
  const [toast, setToast] = React.useState<{ message: string; type: "success" | "error" } | null>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    try {
      const [c, co, t, s] = await Promise.all([
        fetchContacts({ limit: 200 }),
        fetchCompanies({ limit: 200 }),
        fetchTags(),
        fetchStats(),
      ]);
      setContacts(c.contacts);
      setContactTotal(c.total);
      setCompanies(co.companies);
      setCompanyTotal(co.total);
      setTags(t);
      setStats(s);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadAll(); }, [loadAll]);

  const filteredContacts = React.useMemo(() => {
    if (!contactSearch) return contacts;
    const q = contactSearch.toLowerCase();
    return contacts.filter(
      (c) =>
        c.display_name.toLowerCase().includes(q) ||
        (c.job_title ?? "").toLowerCase().includes(q) ||
        (c.company?.name ?? "").toLowerCase().includes(q) ||
        c.emails.some((e) => e.address.toLowerCase().includes(q)) ||
        c.tags.some((t) => t.name.toLowerCase().includes(q))
    );
  }, [contacts, contactSearch]);

  // ─── Contact actions ────────────────────────────────────────────────────────

  async function handleCreateContact(data: Record<string, unknown>) {
    try {
      const c = await createContact(data);
      setContacts((prev) => [c, ...prev]);
      setContactTotal((n) => n + 1);
      setContactFormOpen(false);
      showToast("Contact created", "success");
      loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create contact", "error");
      throw err;
    }
  }

  async function handleUpdateContact(data: Record<string, unknown>) {
    if (!editingContact) return;
    try {
      const c = await updateContact(editingContact.id, data);
      setContacts((prev) => prev.map((x) => x.id === c.id ? c : x));
      if (selectedContact?.id === c.id) setSelectedContact(c);
      setEditingContact(null);
      setContactFormOpen(false);
      showToast("Contact updated", "success");
      loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update contact", "error");
      throw err;
    }
  }

  async function handleDeleteContact(id: string) {
    if (!confirm("Delete this contact?")) return;
    try {
      await apiDeleteContact(id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      setContactTotal((n) => n - 1);
      if (selectedContact?.id === id) setSelectedContact(null);
      showToast("Contact deleted", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete contact", "error");
    }
  }

  // ─── Company actions ────────────────────────────────────────────────────────

  async function handleCreateCompany(data: Record<string, unknown>) {
    try {
      const c = await createCompany(data);
      setCompanies((prev) => [c, ...prev]);
      setCompanyTotal((n) => n + 1);
      setCompanyFormOpen(false);
      showToast("Company created", "success");
      loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create company", "error");
      throw err;
    }
  }

  async function handleUpdateCompany(data: Record<string, unknown>) {
    if (!editingCompany) return;
    try {
      const c = await updateCompany(editingCompany.id, data);
      setCompanies((prev) => prev.map((x) => x.id === c.id ? c : x));
      if (selectedCompany?.id === c.id) setSelectedCompany(c);
      setEditingCompany(null);
      setCompanyFormOpen(false);
      showToast("Company updated", "success");
      loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update company", "error");
      throw err;
    }
  }

  async function handleDeleteCompany(id: string) {
    if (!confirm("Delete this company?")) return;
    try {
      await apiDeleteCompany(id);
      setCompanies((prev) => prev.filter((c) => c.id !== id));
      setCompanyTotal((n) => n - 1);
      if (selectedCompany?.id === id) setSelectedCompany(null);
      showToast("Company deleted", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete company", "error");
    }
  }

  // ─── Tag actions ────────────────────────────────────────────────────────────

  async function handleCreateTag(name: string, color: string, description: string) {
    try {
      const t = await apiCreateTag({ name, color, description: description || undefined });
      setTags((prev) => [...prev, t]);
      showToast("Tag created", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create tag", "error");
    }
  }

  async function handleDeleteTag(id: string) {
    if (!confirm("Delete this tag?")) return;
    try {
      await apiDeleteTag(id);
      setTags((prev) => prev.filter((t) => t.id !== id));
      showToast("Tag deleted", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete tag", "error");
    }
  }

  // ─── Import ─────────────────────────────────────────────────────────────────

  async function handleImport(format: "json" | "csv" | "vcf", data: string) {
    try {
      const result = await importContacts(format, data);
      showToast(`Imported ${result.imported} contacts`, result.errors > 0 ? "error" : "success");
      loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Import failed", "error");
      throw err;
    }
  }

  const navItems: { key: Page; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "contacts", label: "Contacts", icon: <UsersIcon className="size-4" />, count: stats.contacts },
    { key: "companies", label: "Companies", icon: <BuildingIcon className="size-4" />, count: stats.companies },
    { key: "tags", label: "Tags", icon: <TagIcon className="size-4" />, count: stats.tags },
    { key: "import", label: "Import/Export", icon: <ArrowUpDownIcon className="size-4" /> },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <button
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              onClick={() => setPage("contacts")}
            >
              <div className="size-7 rounded-md bg-primary flex items-center justify-center">
                <UsersIcon className="size-4 text-primary-foreground" />
              </div>
              <h1 className="text-base font-semibold">Open <span className="font-normal text-muted-foreground">Contacts</span></h1>
            </button>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setPage(item.key)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    page === item.key
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  {item.icon}
                  {item.label}
                  {item.count != null && (
                    <span className="text-xs text-muted-foreground tabular-nums">({item.count})</span>
                  )}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={loadAll}
              disabled={loading}
              title="Reload"
            >
              <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {page === "contacts" && (
          <div className="flex h-[calc(100vh-56px)]">
            <div className="w-80 border-r flex-shrink-0">
              <ContactList
                contacts={filteredContacts}
                total={contactTotal}
                loading={loading}
                selectedId={selectedContact?.id ?? null}
                onSelect={setSelectedContact}
                onNew={() => { setEditingContact(null); setContactFormOpen(true); }}
                onEdit={(c) => { setEditingContact(c); setContactFormOpen(true); }}
                onDelete={handleDeleteContact}
                search={contactSearch}
                onSearchChange={setContactSearch}
              />
            </div>
            <div className="flex-1 overflow-hidden">
              {selectedContact ? (
                <ContactDetail
                  contact={selectedContact}
                  onClose={() => setSelectedContact(null)}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Select a contact to view details
                </div>
              )}
            </div>
          </div>
        )}

        {page === "companies" && (
          <div className="flex h-[calc(100vh-56px)]">
            <div className="w-80 border-r flex-shrink-0">
              <CompanyList
                companies={companies}
                total={companyTotal}
                loading={loading}
                selectedId={selectedCompany?.id ?? null}
                onSelect={setSelectedCompany}
                onNew={() => { setEditingCompany(null); setCompanyFormOpen(true); }}
                onEdit={(c) => { setEditingCompany(c); setCompanyFormOpen(true); }}
                onDelete={handleDeleteCompany}
                search={companySearch}
                onSearchChange={setCompanySearch}
              />
            </div>
            <div className="flex-1 overflow-hidden">
              {selectedCompany ? (
                <CompanyDetail
                  company={selectedCompany}
                  onClose={() => setSelectedCompany(null)}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Select a company to view details
                </div>
              )}
            </div>
          </div>
        )}

        {page === "tags" && (
          <div className="overflow-y-auto h-[calc(100vh-56px)]">
            <TagList
              tags={tags}
              loading={loading}
              onCreate={handleCreateTag}
              onDelete={handleDeleteTag}
            />
          </div>
        )}

        {page === "import" && (
          <div className="overflow-y-auto h-[calc(100vh-56px)]">
            <ImportExport onImport={handleImport} />
          </div>
        )}
      </main>

      {contactFormOpen && (
        <ContactForm
          contact={editingContact}
          companies={companies}
          tags={tags}
          onSave={editingContact ? handleUpdateContact : handleCreateContact}
          onCancel={() => { setContactFormOpen(false); setEditingContact(null); }}
        />
      )}
      {companyFormOpen && (
        <CompanyForm
          company={editingCompany}
          onSave={editingCompany ? handleUpdateCompany : handleCreateCompany}
          onCancel={() => { setCompanyFormOpen(false); setEditingCompany(null); }}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg ${
          toast.type === "success"
            ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
            : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
