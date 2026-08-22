---
"@hasna/recordings": patch
"@hasna/secrets": patch
"@hasna/projects": patch
---

fix: main CI recovery — regenerate per-app lockfiles after the #856/#923 version waves (frozen-lockfile class), repin projects' dependencies to the published conversations 0.7.4 / mementos 0.14.85 / todos 0.15.41 (the wave-pinned 0.7.5/0.14.86/0.15.43 were never published), sync recordings' Info.plist to 0.3.9 and secrets' runtime version literal to 0.3.4, and clear the publish-guard internal-infra string violations across connectors/emails/skills/secrets/telephony plus the guard's over-broad ARN/domain content patterns.
