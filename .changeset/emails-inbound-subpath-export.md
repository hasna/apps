---
"@hasna/emails": patch
---

Add a storage-free `./inbound` subpath export so other products can reuse the hostile-input inbound primitives without dragging in the database or store layer. The subpath re-exports five dependency-light modules from `src/lib/` — `inbound-mime` (MIME normalization), `sns-signature` (AWS SNS signature verification + topic policy), `webhook-events` (SES notification parser and the sibling Resend webhook parser), `aws-inbound` (SES inbound setup helpers with lazy AWS SDK clients) and `threading` (Message-ID / In-Reply-To / References headers). Nothing that imports `db/`, `store/`, `store-resolution`, or `storage-wiring` is exported; `lib/webhook.ts` is deliberately excluded because it imports the storage seam. A guard test (`src/inbound-subpath.test.ts`) bundles the entrypoint and fails if any re-exported module grows a db/store import. Todos task a3cea05d.
