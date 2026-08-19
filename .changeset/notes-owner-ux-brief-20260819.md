---
"@hasna/notes": patch
---

Owner UX brief 2026-08-19 for the macOS notes app (web UI + native shell):

- Recording screen (req 1): recent notes hide while recording; the composer input is smaller (360px cap, not full-width); only the pause control and the timer stay.
- Glass sidebar (req 3): the purple gradient fill is replaced with a translucent material over the canvas (light ~.58 / dark ~.55 + backdrop blur), dark-canvas text, accent active/focus/scroll tokens — in both themes, app and settings shells.
- Home higher / tighter sidebar top (req 4): home content sits at 6vh instead of dead-center; the native sidebar top padding drops 10px → 4px (traffic-light keep-out untouched).
- Note header (req 5): 'Updated just now' moves onto the top header row, aligned with copy/trash/comments/minimize (data-no-drag).
- Recording popover (req 6): the timer pill sits bottom-center of the window (offset for the sidebar, like the toast), visible on every screen including Home and while the note is being added; the duplicate in-circle composer timer is suppressed.
- Labels (req 7): double-click a label (sidebar filter row or Settings → Labels) — or the pencil icon — edits it inline (Enter/blur commits, Esc cancels); no more window.prompt.
- Trash/archive (req 8): settings/trash/archive become an icon-only row at the sidebar bottom; archive is blended into just Trash (archiving sends notes to Trash; the Trash view shows trashed + archived); trash is never deleted — permanent purge, expired-trash cleanup, the retention picker and the "Deleted forever" countdown are removed, and the native bridge delete()/purge() refuse to delete.
- Settings (req 9): the documented #settings[/tab] deep-link hash is implemented (load + hashchange); renderContent no longer falls through to the editor while the settings shell is active; and the native shell's broken `window.Hasna Notes` hydrate/destroy/recCommand calls (JS SyntaxError since the rename) are fixed to `window.HasnaNotes`.
- App title (req 10): verified 'Hasna Notes' (with the space) on every user-visible surface; no code change needed.

Agent: notes-fix-web
