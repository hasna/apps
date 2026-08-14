import type { Finding } from "../types/index.js";

export function searchFindings(query: string, findings: Finding[]): Finding[] {
  const lowerQuery = query.toLowerCase();

  return findings.filter((finding) => {
    const searchable = [
      finding.message,
      finding.file,
      finding.rule_id,
      finding.scanner_type,
      finding.severity,
      finding.code_snippet ?? "",
      finding.llm_explanation ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return searchable.includes(lowerQuery);
  });
}
