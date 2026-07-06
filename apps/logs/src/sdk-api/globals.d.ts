// Ambient shim for the generated fetch client.
//
// The project targets Bun (lib: ESNext, no DOM). Bun's types provide `fetch`,
// `RequestInit`, and `Response`, but not the `BodyInit` type name the generated
// SDK client uses for its request payload. Declare it here so the generated
// client typechecks without pulling the whole DOM lib (which conflicts with
// Bun's `setInterval`/timer typings).

declare type BodyInit =
  | string
  | ArrayBuffer
  | Blob
  | FormData
  | URLSearchParams
  | ReadableStream<Uint8Array>;
