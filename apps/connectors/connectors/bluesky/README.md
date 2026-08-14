# @hasna/connect-bluesky

Bluesky / AT Protocol connector. Stateless, raw-`fetch` transport with **zero runtime
dependencies**.

## Auth

Pass credentials per call — nothing is stored on disk:

```ts
import { Bluesky } from "@hasna/connect-bluesky";

const bsky = new Bluesky({
  identifier: "alice.bsky.social", // handle or DID
  appPassword: "xxxx-xxxx-xxxx-xxxx", // app password, NOT the account password
  pds: "https://bsky.social", // optional, defaults to bsky.social
});
```

## Operations

| Method | AT Protocol endpoint |
|--------|----------------------|
| `bsky.me()` | `com.atproto.server.createSession` |
| `bsky.createPost({ text, replyToUri? })` | `com.atproto.repo.createRecord` (`app.bsky.feed.post`) |
| `bsky.deletePost(uri)` | `com.atproto.repo.deleteRecord` |
| `bsky.uploadBlob(buffer, mimeType)` | `com.atproto.repo.uploadBlob` |
| `bsky.listNotifications()` | `app.bsky.notification.listNotifications` |
| `bsky.getPosts(uris)` | `app.bsky.feed.getPosts` |

Threads: `createPost` with `replyToUri` resolves the parent strong-ref and the thread
root automatically (deep threads stay correctly rooted).

This connector is consumed by the stateless `@hasna/connectors/social` transport SDK.
