/**
 * In-memory S3 for tests. Intercepts PUT/GET/HEAD against the virtual-hosted or
 * path-style URL the store composes, keyed by the object key parsed from the URL.
 * Lets the real EstateS3Store (SigV4 signing + URL composition) run against a
 * deterministic fixture with zero network and zero ambient credentials.
 */
import type { FetchLike } from "../store.js";

export interface MemoryS3State {
  objects: Map<string, Uint8Array>;
  putCount: number;
  getCount: number;
  headCount: number;
}

export function createMemoryS3(): { fetch: FetchLike; state: MemoryS3State } {
  const state: MemoryS3State = {
    objects: new Map<string, Uint8Array>(),
    putCount: 0,
    getCount: 0,
    headCount: 0,
  };

  function keyFromUrl(url: string): string {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const raw = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    if (host.endsWith(".s3.amazonaws.com") || host.includes(".s3.")) {
      // virtual-hosted style: <bucket>.s3.<region>.amazonaws.com/<key>
      return raw;
    }
    // path style: s3.<region>.amazonaws.com/<bucket>/<key> — drop the bucket segment
    return raw.split("/").slice(1).join("/");
  }

  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const key = keyFromUrl(url);

    if (method === "PUT") {
      state.putCount += 1;
      const body = init?.body;
      let bytes: Uint8Array;
      if (body instanceof Uint8Array) bytes = body;
      else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
      else if (typeof body === "string") bytes = new TextEncoder().encode(body);
      else if (body instanceof ReadableStream) {
        bytes = new Uint8Array(await new Response(body).arrayBuffer());
      } else {
        bytes = new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
      }
      state.objects.set(key, bytes);
      return new Response("", { status: 200 });
    }

    if (method === "HEAD") {
      state.headCount += 1;
      return state.objects.has(key) ? new Response("", { status: 200 }) : new Response("", { status: 404 });
    }

    if (method === "GET") {
      state.getCount += 1;
      const bytes = state.objects.get(key);
      if (!bytes) return new Response("", { status: 404 });
      return new Response(toArrayBuffer(bytes), { status: 200 });
    }

    return new Response("", { status: 405 });
  };

  return { fetch, state };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
