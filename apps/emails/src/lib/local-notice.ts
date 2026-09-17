// The one line a LOCAL Emails run prints, so an unhosted run can never be
// mistaken for a hosted one that came back empty (owner ruling 2026-09-04).
//
// Local SQLite is reached only by an EXPLICIT operator choice — the standard
// opt-in HASNA_EMAILS_LOCAL=1 (alias EMAILS_LOCAL=1, src/lib/local-opt-in.ts);
// a database path only says where the file lives — and saying "LOCAL" on stderr
// makes that choice visible in a captured or piped log while `--json` stdout
// stays machine-readable. One line, once per process, the standard cross-app shape.

/** The notice text, stable so a test can assert it. */
export const LOCAL_EMAILS_NOTICE =
  "emails: LOCAL mode — reading and writing the on-box SQLite database (HASNA_EMAILS_LOCAL=1; " +
  "the file named by HASNA_EMAILS_DB_PATH, else the default under ~/.hasna/emails). " +
  "The hosted Emails API is not involved.";

let localNoticePrinted = false;

/** Say — once per process, on stderr — that this install is running locally. */
export function noticeLocalEmailsMode(
  write: (line: string) => void = (line) => console.error(line),
): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  write(LOCAL_EMAILS_NOTICE);
}

/** Test seam: forget that the local-mode line was printed. */
export function resetLocalEmailsNoticeForTests(): void {
  localNoticePrinted = false;
}