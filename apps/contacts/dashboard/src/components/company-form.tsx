import * as React from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CompanyWithDetails } from "@/types";

interface CompanyFormProps {
  company?: CompanyWithDetails | null;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export function CompanyForm({ company, onSave, onCancel }: CompanyFormProps) {
  const [name, setName] = React.useState(company?.name ?? "");
  const [domain, setDomain] = React.useState(company?.domain ?? "");
  const [industry, setIndustry] = React.useState(company?.industry ?? "");
  const [size, setSize] = React.useState(company?.size ?? "");
  const [foundedYear, setFoundedYear] = React.useState(company?.founded_year ? String(company.founded_year) : "");
  const [description, setDescription] = React.useState(company?.description ?? "");
  const [notes, setNotes] = React.useState(company?.notes ?? "");
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        domain: domain || undefined,
        industry: industry || undefined,
        size: size || undefined,
        founded_year: foundedYear ? parseInt(foundedYear, 10) : undefined,
        description: description || undefined,
        notes: notes || undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold">{company ? "Edit Company" : "New Company"}</h2>
          <button onClick={onCancel} className="p-1 hover:bg-accent rounded-md">
            <XIcon className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Company Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Domain</label>
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Industry</label>
              <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Technology" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Size</label>
              <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="1-10, 11-50, etc." />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Founded Year</label>
              <Input
                type="number"
                value={foundedYear}
                onChange={(e) => setFoundedYear(e.target.value)}
                placeholder="2020"
                min="1800"
                max={new Date().getFullYear()}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description..."
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm resize-none"
            />
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
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Saving..." : company ? "Save Changes" : "Create Company"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
