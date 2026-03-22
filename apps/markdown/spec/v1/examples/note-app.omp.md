# NoteApp

@use mcp:filesystem
@import ./shared/auth-form.omp.md

---

type: project
id: init
name: NoteApp
framework: nextjs@14
language: typescript
styling: tailwindcss
pkg: bun

Initialize with strict TypeScript. Add lucide-react for icons.

---

type: database
id: db
engine: sqlite
orm: drizzle
file: data/notes.db
depends: init

Drizzle ORM with SQLite. Client at `src/db/index.ts`.

---

type: table
id: users
db: db

| column   | type | constraints       |
|----------|------|-------------------|
| id       | text | primary key, uuid |
| email    | text | unique, not null  |
| name     | text | not null          |
| password | text | not null          |

---

type: table
id: notes
db: db

| column     | type     | constraints             |
|------------|----------|-------------------------|
| id         | text     | primary key, uuid       |
| user_id    | text     | foreign key -> users.id |
| title      | text     | not null                |
| content    | text     | not null, default ''    |
| pinned     | boolean  | default false           |
| updated_at | datetime | default now             |

Cascade delete with user. Refresh updated_at on update.

accepts: updated_at changes on update; cascade delete with user

---

type: table
id: tags
db: db

| column | type | constraints       |
|--------|------|-------------------|
| id     | text | primary key, uuid |
| name   | text | unique, not null  |
| color  | text | default '#6B7280' |

---

type: table
id: note-tags
db: db
primary-key: [note_id, tag_id]
on-delete: cascade

| column  | type | constraints             |
|---------|------|-------------------------|
| note_id | text | foreign key -> notes.id |
| tag_id  | text | foreign key -> tags.id  |

---

type: migration
id: db-push
depends: users, notes, tags, note-tags

Push schema with `drizzle-kit push`.

accepts: all tables exist; no errors

---

type: auth
id: auth
method: email+password
library: lucia-auth
hash: argon2
session: cookie
depends: db-push

Lucia Auth with argon2. Secret: {{random(64, alphanumeric)}}. Signup/login at `/api/auth/*`. Redirect pages to `/login`, 401 for API.

accepts: passwords hashed; HTTP-only cookie; API returns 401

---

@crud-api(notes, title|content|pinned)

---

@crud-api(tags, name|color)

---

@page-set(notes, search|tags|editor)

---

type: layout
id: root-layout
scope: root
nav: [/notes: All Notes, /tags: Tags]
depends: init

Left sidebar: {{suggest a lucide-react icon for notes}} icon, "NoteApp", nav links. User email and logout at bottom. Hamburger below 768px.

accepts: sidebar collapses below 768px; logout visible

---

type: seed
id: seed
admin-email: andrei@hasna.com
sample-notes: 10
sample-tags: [work, personal, ideas, urgent, reference]
depends: db-push, auth

Admin password {{random(32, alphanumeric)}} printed to console. Second user "Jane Doe" (jane@example.com). 10 notes between both users: {{generate 10 note titles for a productivity app}}. 1-3 tags per note. Add `db:seed`.

accepts: two users; 10 notes with tags; password printed

---

type: deploy
id: deploy
provider: vercel
env: [DATABASE_URL, SESSION_SECRET]
hooks: build: bun run build, postdeploy: bun run db:push
depends: seed

Deploy to Vercel. Env vars from `.env.production`. Preview deploys for PRs.

accepts: build succeeds; db schema current

---

type: test
id: notes-tests
pattern: src/__tests__/**/*.test.ts
framework: vitest
depends: auth, db-push

- GET /api/notes returns 401 without session
- GET /api/notes returns only user's own notes
- POST /api/notes creates note with uuid
- POST /api/notes returns 422 when title missing
- PUT /api/notes/:id refreshes updated_at
- DELETE /api/notes/:id removes note and tag joins
- GET /api/notes?q=term filters by title and content

accepts: all pass; coverage above 90%
