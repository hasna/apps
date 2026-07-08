import { useState } from "react";
import type { FieldType } from "@hasna/tables";

const TYPES: FieldType[] = [
  "text",
  "number",
  "singleSelect",
  "date",
  "checkbox",
  "formula",
];

interface AddFieldDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string, type: FieldType, formula?: string) => void;
}

export function AddFieldDialog({ open, onClose, onSubmit }: AddFieldDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [formula, setFormula] = useState("");

  if (!open) return null;

  const submit = () => {
    if (!name.trim()) return;
    onSubmit(name.trim(), type, type === "formula" ? formula : undefined);
    setName("");
    setType("text");
    setFormula("");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold text-slate-900">Add field</h2>

        <label className="mb-1 block text-xs font-medium text-slate-500">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Field name"
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />

        <label className="mb-1 block text-xs font-medium text-slate-500">Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {type === "formula" && (
          <>
            <label className="mb-1 block text-xs font-medium text-slate-500">Formula</label>
            <input
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="{Impact} / {Effort}"
              className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
            />
          </>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Add field
          </button>
        </div>
      </div>
    </div>
  );
}
