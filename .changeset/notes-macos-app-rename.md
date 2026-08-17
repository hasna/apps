---
"@hasna/notes": patch
---

macOS app rename + proper signing: the WKWebView shell builds as HasnaNotes.app (bundle id com.hasna.notes unchanged), signed with the fleet Developer ID identity "Developer ID Application: VASILE ANDREI HASNA (HKZ326A8Y3)" instead of ad-hoc. In-app UI strings, web UI branding, and the JS bridge global are renamed to HasnaNotes (window.PersonalNotes alias removed); the sidecar auth header is now X-Hasna-Notes-Token only. Build/deploy scripts renamed to scripts/build_notes.sh and scripts/deploy_notes.sh; deploy backs up and removes legacy installs that share the bundle id (bundle-id scan, no hardcoded legacy display names).
