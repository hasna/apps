export const meta = {
  name: 'move-app-to-internal',
  description: 'Move one or more apps from this public producer monorepo (hasna/apps, @hasna/<name>) into the private hasna-internal/internal-apps monorepo (@hasna-internal/<name>). Parameterized: edit the APPS array. Steps: survey (no public consumers, source at origin/main, internal-apps registry tuple free) -> move (worktree in internal-apps, rename package, dep-direction + registry gates) -> verify (both repos CI, publish @hasna-internal/<name>, record). Owner-authorized class; instance precedent: datasets -> internal-apps (2026-08-24, task 41, @hasna-internal/datasets).',
  phases: [
    { title: 'Survey', detail: 'verify each app is movable: no public @hasna consumers, source at origin/main, internal-apps tuple free' },
    { title: 'Move', detail: 'one app at a time: internal-apps worktree, package rename, registry tuple, dep-direction gates' },
    { title: 'Verify', detail: 'both repos CI green, publish @hasna-internal/<name>, record on the todos row' },
  ],
}

const APPS = [
  // { name: '<app>', reason: '<one-line why it moves>' }
]

const SURVEY = { type: 'object', properties: { movable: { type: 'array' }, blocked: { type: 'array' } }, required: ['movable', 'blocked'] }
const MOVE = { type: 'object', properties: { moved: { type: 'array' }, failed: { type: 'array' } }, required: ['moved', 'failed'] }

phase('Survey')
const survey = await agent(`SURVEY the apps listed for move to hasna-internal/internal-apps. Apps: ${JSON.stringify(APPS)}. Read-only — nothing modified.

For EACH app (name, reason):
1. Source: confirm apps/<name> exists at origin/main in hasna/apps (git ls-tree origin/main apps/<name>/package.json) and its package.json name is @hasna/<name> with the four-surface contract (CLI bin, MCP bin, -serve bin, ./sdk).
2. Public consumers: search the hasna/apps monorepo (git grep -l '"@hasna/<name>"' origin/main -- apps/ excludes the app itself) AND the open-source orgs for any package that depends on @hasna/<name> as a runtime dep. A public consumer OUTSIDE hasna/apps blocks the move (the package must stay published or the consumer must migrate first — record which).
3. Internal-apps tuple: check hasna-internal/internal-apps internal-apps.registry.json (fetch origin main) — the @hasna-internal/<name> name must be free, and the repo row must not already exist. A taken name blocks.
4. Publish state: npm view @hasna/<name> version (via the lane token pairing, never print the token) — record the last published version (it stays published for the move window; consumers keep installing the old version).

Classify: MOVABLE = source present AND no external public consumer AND tuple free. BLOCKED = any role missing, with the exact role named.
Return {movable: [{name, reason, publishedVersion}], blocked: [{name, missingRole, reason}]}.`, { label: 'move-survey', phase: 'Survey', schema: SURVEY })
if (!survey || survey.movable.length === 0) return { status: 'move-survey-only', movable: [], blocked: survey ? survey.blocked : [], moved: [], failed: [] }
log(`move survey: ${survey.movable.length} movable, ${survey.blocked.length} blocked`)

phase('Move')
const m = await agent(`MOVE the surveyed apps ONE AT A TIME from hasna/apps (public @hasna/<name>) into hasna-internal/internal-apps (private @hasna-internal/<name>). Movable set: ${JSON.stringify(survey.movable)}.

The precedent is the datasets move (2026-08-24): source moved into the internal-apps monorepo, package renamed @hasna/datasets -> @hasna-internal/datasets, internal-apps.registry.json tuple added, dep-direction + name-conformance gates re-run, published under the internal scope from the internal-apps tree.

For EACH app, in this order:
1. Worktree: internal-apps repo worktree at $HOME/.hasna/repos/worktrees/internal-apps/<name> cut from origin/main (fetch first). Never the shared checkout.
2. Move source: copy apps/<name> source into the internal-apps monorepo at apps/<scope>/<name>/ (scope per the internal-apps layout: apps/hasna/ | apps/hasnaxyz/ | apps/hasnafamily/ for @hasna/* | @hasnaxyz/* | @hasnafamily/* — an app becoming @hasna-internal/<name> sits at packages/<name>/ ONLY if it is a utility; a full app goes to the scope dir that matches its future @hasna/<scope-prefix> name, or the internal-apps registry authority decides).
3. Rename: package.json name -> @hasna-internal/<name> (or the scope-matching public name if the app keeps a public story), exports/bin paths fixed, imports of its own name updated.
4. Registry tuple: add the immutable tuple (repo, frozen source SHA, manifest path+hash, role, target package name, access, vault lane key, workspace inclusion, publish eligibility) to internal-apps.registry.json per the registry authority — never a folder-name guess.
5. Gates: bun run check in internal-apps (names + secrets + manifests + registry + scope + deps + identities) and confirm the hasna/apps side no longer references the moved app (remove the apps/<name> dir from hasna/apps via its own worktree+PR, or mark archived if the app must keep a public shadow).
6. PR-first in both repos: internal-apps move PR + hasna/apps removal PR, each reviewed, each with the Agent: trailer, each with staged secrets scan rc=0.

Return {moved: [{name, internalPackage, internalPr, appsPr, publishEligible}], failed: [{name, reason}]}.`, { label: 'move-apps', phase: 'Move', schema: MOVE })

phase('Verify')
const v = await agent(`VERIFY the move run. Moved: ${JSON.stringify(m ? m.moved : [])}, failed: ${JSON.stringify(m ? m.failed : [])}.
1. For each moved app: the internal-apps PR exists and its head passes bun run check (value-safe projection: gh pr checks <n> --json name,bucket,state,conclusion — name/state/conclusion only, never the full payload); the hasna/apps removal PR exists; both PR bodies end with the Agent trailer.
2. Publish state: if publishEligible, confirm @hasna-internal/<name> is published (npm view @hasna-internal/<name> version via the lane token pairing) OR the publish is queued on the owning lane — record which.
3. Record: comment the owning todos row with the two PR numbers + published version (or queue state).
Return {verified: [{name, internalPr, appsPr, checkGreen, published: bool|null}], gaps: [string]}.`, { label: 'move-verify', phase: 'Verify' })

return { status: 'move-run-complete', movable: survey.movable, blocked: survey.blocked, moved: m ? m.moved : [], failed: m ? m.failed : [], verify: v }
