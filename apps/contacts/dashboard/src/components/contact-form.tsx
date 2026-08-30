import * as React from "react";
import { XIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ContactWithDetails, CompanyWithDetails, Tag } from "@/types";

interface ContactFormProps {
  contact?: ContactWithDetails | null;
  companies: CompanyWithDetails[];
  tags: Tag[];
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export function ContactForm({ contact, companies, tags, onSave, onCancel }: ContactFormProps) {
  const [firstName, setFirstName] = React.useState(contact?.first_name ?? "");
  const [lastName, setLastName] = React.useState(contact?.last_name ?? "");
  const [displayName, setDisplayName] = React.useState(contact?.display_name ?? "");
  const [jobTitle, setJobTitle] = React.useState(contact?.job_title ?? "");
  const [companyId, setCompanyId] = React.useState(contact?.company_id ?? "");
  const [notes, setNotes] = React.useState(contact?.notes ?? "");
  const [birthday, setBirthday] = React.useState(contact?.birthday ?? "");
  const [emails, setEmails] = React.useState<Array<{ address: string; type: string }>>(
    contact?.emails?.map((e) => ({ address: e.address, type: e.type })) ?? [{ address: "", type: "work" }]
  );
  const [phones, setPhones] = React.useState<Array<{ number: string; type: string }>>(
    contact?.phones?.map((p) => ({ number: p.number, type: p.type })) ?? []
  );
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>(
    contact?.tags?.map((t) => t.id) ?? []
  );
  const [saving, setSaving] = React.useState(false);

  // Auto-fill display name from first/last
  React.useEffect(() => {
    if (!contact && !displayName) {
      const auto = [firstName, lastName].filter(Boolean).join(" ");
      if (auto) setDisplayName(auto);
    }
  }, [firstName, lastName, contact, displayName]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        display_name: displayName || [firstName, lastName].filter(Boolean).join(" ") || "Unnamed",
        job_title: jobTitle || undefined,
        company_id: companyId || undefined,
        notes: notes || undefined,
        birthday: birthday || undefined,
        emails: emails.filter((e) => e.address).map((e, i) => ({
          address: e.address,
          type: e.type,
          is_primary: i === 0,
        })),
        phones: phones.filter((p) => p.number).map((p, i) => ({
          number: p.number,
          type: p.type,
          is_primary: i === 0,
        })),
        tag_ids: selectedTagIds,
      };
      await onSave(data);
    } finally {
      setSaving(false);
    }
  }

  function toggleTag(id: string) {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold">{contact ? "Edit Contact" : "New Contact"}</h2>
          <button onClick={onCancel} className="p-1 hover:bg-accent rounded-md">
            <XIcon className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">First Name</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Last Name</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Display Name *</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Job Title</label>
              <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Job title" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Company</label>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="">— None —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Emails */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Emails</label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEmails([...emails, { address: "", type: "work" }])}
              >
                <PlusIcon className="size-3 mr-1" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {emails.map((email, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    type="email"
                    value={email.address}
                    onChange={(e) => {
                      const next = [...emails];
                      next[i] = { ...next[i]!, address: e.target.value };
                      setEmails(next);
                    }}
                    placeholder="email@example.com"
                    className="flex-1"
                  />
                  <select
                    value={email.type}
                    onChange={(e) => {
                      const next = [...emails];
                      next[i] = { ...next[i]!, type: e.target.value };
                      setEmails(next);
                    }}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="work">Work</option>
                    <option value="personal">Personal</option>
                    <option value="other">Other</option>
                  </select>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-9"
                    onClick={() => setEmails(emails.filter((_, j) => j !== i))}
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Phones */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Phones</label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPhones([...phones, { number: "", type: "mobile" }])}
              >
                <PlusIcon className="size-3 mr-1" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {phones.map((phone, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={phone.number}
                    onChange={(e) => {
                      const next = [...phones];
                      next[i] = { ...next[i]!, number: e.target.value };
                      setPhones(next);
                    }}
                    placeholder="+1 555 0100"
                    className="flex-1"
                  />
                  <select
                    value={phone.type}
                    onChange={(e) => {
                      const next = [...phones];
                      next[i] = { ...next[i]!, type: e.target.value };
                      setPhones(next);
                    }}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="mobile">Mobile</option>
                    <option value="work">Work</option>
                    <option value="home">Home</option>
                    <option value="fax">Fax</option>
                    <option value="other">Other</option>
                  </select>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-9"
                    onClick={() => setPhones(phones.filter((_, j) => j !== i))}
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Tags</label>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    className="rounded-full px-3 py-1 text-xs font-medium border transition-all"
                    style={
                      selectedTagIds.includes(t.id)
                        ? { backgroundColor: t.color, color: "white", borderColor: t.color }
                        : { backgroundColor: "transparent", borderColor: t.color + "60", color: t.color }
                    }
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Birthday</label>
            <Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes..."
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : contact ? "Save Changes" : "Create Contact"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
