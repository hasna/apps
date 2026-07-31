# BlogPlatform

@use mcp:filesystem

---

type: project
id: init
name: BlogPlatform
framework: nextjs@14
language: typescript
styling: tailwindcss
pkg: bun

Initialize with strict TypeScript. Install `@tailwindcss/typography`, `date-fns`, `react-markdown`.

---

type: database
id: db
engine: postgresql
orm: drizzle
url: {{env:DATABASE_URL}}
depends: init

Drizzle ORM with PostgreSQL. Client at `src/db/index.ts`, pool max 10.

---

type: table
id: users
db: db

| column   | type | constraints        |
|----------|------|--------------------|
| id       | text | primary key, uuid  |
| email    | text | unique, not null   |
| name     | text | not null           |
| password | text | not null           |
| role     | text | default 'author'   |
| bio      | text | nullable           |

Role: "admin" or "author".

---

type: table
id: categories
db: db

| column | type | constraints       |
|--------|------|-------------------|
| id     | text | primary key, uuid |
| name   | text | unique, not null  |
| slug   | text | unique, not null  |

---

type: table
id: posts
db: db

| column       | type     | constraints                            |
|--------------|----------|----------------------------------------|
| id           | text     | primary key, uuid                      |
| author_id    | text     | foreign key -> users.id                |
| category_id  | text     | foreign key -> categories.id, nullable |
| title        | text     | not null                               |
| slug         | text     | unique, not null                       |
| content      | text     | not null                               |
| excerpt      | text     | nullable                               |
| status       | text     | default 'draft'                        |
| published_at | datetime | nullable                               |
| updated_at   | datetime | default now                            |

Status: "draft", "published", "archived". Cascade delete with author.

accepts: slug unique; status enforced; updated_at refreshes

---

type: table
id: comments
db: db

| column       | type     | constraints              |
|--------------|----------|--------------------------|
| id           | text     | primary key, uuid        |
| post_id      | text     | foreign key -> posts.id  |
| author_name  | text     | not null                 |
| author_email | text     | not null                 |
| body         | text     | not null                 |
| approved     | boolean  | default false            |

Cascade delete with post. Admin approval required before display.

---

type: migration
id: db-push
depends: users, categories, posts, comments

Push schema with `drizzle-kit push`.

accepts: all tables exist; foreign keys valid

---

type: auth
id: auth
method: email+password
library: lucia-auth
hash: argon2
session: cookie
depends: db-push

Lucia Auth with argon2 and cookies. Secret: {{random(64, alphanumeric)}}. Admins manage all posts; authors only their own.

accepts: role-based access enforced; passwords hashed

---

@crud-api(posts, title|content|excerpt|category_id|status)

---

type: endpoint
id: create-comment
method: POST
path: /api/posts/:postId/comments
auth: none
body: {author_name: string, author_email: string, body: string}
depends: auth

Create unapproved comment on published post. 404 for unpublished, 422 for missing fields.

accepts: starts unapproved; 404 unpublished; 422 missing fields

---

type: endpoint
id: approve-comment
method: PATCH
path: /api/comments/:id/approve
auth: required
depends: auth

Admin-only approval. 403 for non-admins.

---

type: layout
id: root-layout
scope: root
nav: [/: Home, /blog: Blog, /admin: Dashboard]
depends: init

Top nav: logo left, links center, login/avatar right. Footer with RSS link. Hamburger below 768px.

accepts: nav collapses on mobile; auth state in header

---

type: page
id: home-page
path: /
auth: none
depends: root-layout

5 recent published posts as hero cards. Category grid with post counts below.

---

type: page
id: blog-list
path: /blog
auth: none
depends: root-layout, list-posts

Paginated list (12/page) with title, excerpt, category badge. Sidebar: category filters, search debounced 300ms.

accepts: pagination works; search debounced 300ms

---

type: page
id: post-detail
path: /blog/:slug
auth: none
depends: root-layout, create-comment

Full post with `@tailwindcss/typography` prose. Comment form below, approved comments list. "Pending approval" after submit.

accepts: prose styled; comment form validates

---

type: page
id: admin-dashboard
path: /admin
auth: required
depends: root-layout

Stats overview, post table with status badges and actions, pending comments tab.

accepts: auth required; pending tab works

---

type: page
id: post-editor
path: /admin/posts/new
auth: required
depends: root-layout

Split-pane markdown editor with live preview. Auto-slug from title, category dropdown, draft/publish toggle.

accepts: slug auto-generates; live preview works

---

type: email
id: welcome-email
to: user.email
subject: Welcome to BlogPlatform
trigger: on:signup
from: noreply@blogplatform.com
depends: auth

Greet by name, link to `/admin/posts/new`. HTML with plain-text fallback.

accepts: sent on signup; contains user name

---

type: cron
id: rss-generator
schedule: 0 */6 * * *
action: generate-rss-feed
timeout: 2m
depends: db-push

RSS 2.0 of 50 recent posts. Description: "{{generate a one-line RSS description for a multi-author blog}}". Write to `public/rss.xml`.

accepts: valid RSS 2.0; file at public/rss.xml

---

type: seed
id: seed
admin-email: andrei@hasna.com
depends: db-push, auth

Admin password {{random(32, alphanumeric)}} to console. Author "Sarah Chen" (sarah@example.com). Categories: {{generate 5 blog category names}}. Posts: {{generate 10 blog post titles}} (8 published, 2 draft). 3-5 comments per published post.

accepts: 10 posts across categories; comments seeded

---

type: deploy
id: deploy
provider: vercel
env: [DATABASE_URL, SESSION_SECRET]
region: us-east-1
domain: blog.example.com
hooks: build: bun run build, postdeploy: bun run db:push
depends: seed

Vercel with custom domain. ISR for blog pages, 60s revalidation.

accepts: build succeeds; ISR at 60s
