import * as React from "react";
import { UploadIcon, DownloadIcon, FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportUrl } from "@/lib/api";

interface ImportExportProps {
  onImport: (format: "json" | "csv" | "vcf", data: string) => Promise<void>;
}

export function ImportExport({ onImport }: ImportExportProps) {
  const [importing, setImporting] = React.useState(false);
  const [result, setResult] = React.useState<{
    imported: number;
    errors: number;
    error_details: string[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    const format: "json" | "csv" | "vcf" | null =
      ext === "json" ? "json" :
      ext === "csv" ? "csv" :
      ext === "vcf" || ext === "vcard" ? "vcf" :
      null;

    if (!format) {
      setErrorMsg("Unsupported file format. Use .json, .csv, or .vcf");
      return;
    }

    const data = await file.text();
    setImporting(true);
    setResult(null);
    setErrorMsg(null);

    try {
      await onImport(format, data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-8 p-6 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold mb-1">Import & Export</h2>
        <p className="text-sm text-muted-foreground">Import contacts from a file or export all contacts.</p>
      </div>

      {/* Import */}
      <div className="border rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2">
          <UploadIcon className="size-5 text-primary" />
          <h3 className="font-medium">Import Contacts</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Supported formats: JSON, CSV (Google Contacts style), vCard (.vcf)
        </p>

        <div
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <FileTextIcon className="size-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">Click to select file</p>
          <p className="text-xs text-muted-foreground mt-1">.json, .csv, .vcf, .vcard</p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv,.vcf,.vcard"
          onChange={handleFileChange}
          className="hidden"
        />

        {importing && (
          <div className="text-sm text-muted-foreground">Importing...</div>
        )}

        {result && (
          <div className={`text-sm p-3 rounded-md ${result.errors === 0 ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200"}`}>
            Imported {result.imported} contact{result.imported !== 1 ? "s" : ""}.
            {result.errors > 0 && ` ${result.errors} error${result.errors !== 1 ? "s" : ""}.`}
          </div>
        )}

        {errorMsg && (
          <div className="text-sm p-3 rounded-md bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Export */}
      <div className="border rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2">
          <DownloadIcon className="size-5 text-primary" />
          <h3 className="font-medium">Export Contacts</h3>
        </div>
        <p className="text-sm text-muted-foreground">Download all contacts in your preferred format.</p>

        <div className="flex gap-3 flex-wrap">
          {(["json", "csv", "vcf"] as const).map((fmt) => (
            <a key={fmt} href={exportUrl(fmt)} download={`contacts.${fmt}`}>
              <Button variant="outline" size="sm">
                <DownloadIcon className="size-3 mr-1" />
                Export as .{fmt.toUpperCase()}
              </Button>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
