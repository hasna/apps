/** Duplicate original redirected descriptors before Bun attaches its PTY. */
export async function terminalDescriptorDuplicator() {
  const {dlopen}=await import("bun:ffi");
  const candidates=process.platform==="darwin"?["/usr/lib/libSystem.B.dylib"]:
    ["libc.so.6",`/lib/libc.musl-${process.arch==="arm64"?"aarch64":"x86_64"}.so.1`];
  for(const library of candidates) {
    try {
      const handle=dlopen(library,{dup:{args:["int"],returns:"int"}});
      return {duplicate(fd:number){const copy=handle.symbols.dup(fd);if(copy<3)throw new Error("A redirected terminal descriptor could not be duplicated.");return copy;},close:()=>handle.close()};
    } catch {}
  }
  throw new Error("Mixed terminal redirection requires the system C library's dup function on this platform.");
}
