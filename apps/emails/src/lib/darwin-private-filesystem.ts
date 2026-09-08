import { fstatSync } from "node:fs";
import { getSystemErrorName } from "node:util";

export type NativeOps = {
  open: (fd: number, name: string, flags: number, mode?: number) => number;
  link: (fd: number, source: string, target: string) => void;
  unlink: (fd: number, name: string) => void;
  assertPrivateAcl: (fd: number) => void;
};
let nativeOps: Promise<NativeOps> | undefined;
// Darwin's sys/fcntl.h; node:fs.constants does not expose O_CLOEXEC.
const O_CLOEXEC = 0x01000000;

export function darwinOps(): Promise<NativeOps> {
  return nativeOps ??= (async () => {
    if (process.platform !== "darwin") throw new Error("Darwin attachment operations are unavailable");
    const { dlopen, CString, read } = await import("bun:ffi");
    // Public openat is variadic: a fixed fourth FFI argument corrupts the create
    // mode on arm64 macOS. Apple's wrapper calls this fixed-arity syscall stub:
    // apple-oss-distributions/xnu/libsyscall/wrappers/open-base.c, __openat.
    // No runtime compiler, process chdir, or path-based fallback is used. An OS
    // without these symbols fails closed before an attachment is written.
    const library = dlopen("/usr/lib/libSystem.B.dylib", {
      __openat: { args: ["i32", "cstring", "i32", "u16"], returns: "i32" },
      linkat: { args: ["i32", "cstring", "i32", "cstring", "i32"], returns: "i32" },
      unlinkat: { args: ["i32", "cstring", "i32"], returns: "i32" },
      __error: { args: [], returns: "ptr" },
      acl_get_fd_np: { args: ["i32", "i32"], returns: "ptr" },
      acl_to_text: { args: ["ptr", "ptr"], returns: "ptr" },
      acl_free: { args: ["ptr"], returns: "i32" },
    });
    const fail = (operation: string): never => {
      const code = getSystemErrorName(-read.i32(library.symbols.__error()!));
      throw Object.assign(new Error(`attachment ${operation} failed (${code})`), { code });
    };
    const nameBytes = (name: string) => {
      if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) throw new Error("invalid attachment path component");
      return Buffer.from(name + "\0");
    };
    return {
      open(fd, name, flags, mode = 0) {
        const result = library.symbols.__openat(fd, nameBytes(name), flags | O_CLOEXEC, mode);
        if (result < 0) return fail("open");
        return result;
      },
      link(fd, source, target) {
        if (library.symbols.linkat(fd, nameBytes(source), fd, nameBytes(target), 0) !== 0) fail("publish");
      },
      unlink(fd, name) {
        if (library.symbols.unlinkat(fd, nameBytes(name), 0) !== 0) fail("cleanup");
      },
      assertPrivateAcl(fd) {
        // Darwin ACL grants can bypass POSIX mode bits. Normal macOS Downloads
        // has an everyone-deny-delete ACE, which is safe; fail closed on grants.
        const acl = library.symbols.acl_get_fd_np(fd, 0x100); // ACL_TYPE_EXTENDED
        if (!acl) {
          // Libc's acl_get_fd_np uses filesec_get_property(FILESEC_ACL),
          // which reports ENOENT when this valid descriptor has no ACL.
          const errno = read.i32(library.symbols.__error()!);
          if (errno === 2) { fstatSync(fd); return; }
          return fail("ACL inspection");
        }
        try {
          const text = library.symbols.acl_to_text(acl, null);
          if (!text) return fail("ACL inspection");
          try {
            if (/:allow:/i.test(new CString(text).toString())) throw new Error("attachment output directory or ancestor has an ACL granting access");
          } finally { library.symbols.acl_free(text); }
        } finally { library.symbols.acl_free(acl); }
      },
    };
  })();
}

