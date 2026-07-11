#!/usr/bin/python3
"""Pinned, provider-independent E2B guest broker v1.

The broker's only stdout bytes are authenticated, bounded JSON protocol frames.
It is intentionally not production-admitted by the host package.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import ctypes
import errno
import hashlib
import hmac
import json
import os
import pwd
import resource
import secrets
import selectors
import signal
import stat
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any, BinaryIO, NoReturn


MAX_FRAME_BYTES = 1024 * 1024
MAX_BLOB_BYTES = 512 * 1024
MAX_PATH_BYTES = 4096
MAX_DEPTH = 64
MAX_FILES = 10_000
MAX_DURATION_MS = 60_000
MAX_SESSION_REQUESTS = 10_000
MAX_PENDING_OPERATIONS = 32
PROTOCOL_DESCRIPTION = (
    "sandboxes.e2b-guest-broker/v1|bootstrap=python3-I-c-verified-fd;launcher=sha256:0ffdcea4fd1bfc4bf98c638db370204a9507cdc829c20319e2a8e98b9b622d00;path=/opt/hasna/bin/sandboxes-broker-v1|"
    "init=E2BGBK1\\0+session32+key32|frame=canonical-rfc8259-sorted-utf8-lf;max=1048576;hmac=sha256;strict-sequence-session-nonce;closed-fields|"
    "ops=exec,file_stat,file_read,file_write,file_list,checkpoint;exec_limit=1;cancel=false;resume=false|"
    "exec=absolute-argv,no-shell,fixed-env,no-new-privs,uid-drop,wall+idle+combined-output+pids-rlimit;abnormal=sticky-destroy-required|"
    "paths=relative,max4096,maxdepth64,no-empty-dot-dotdot-git,no-follow|"
    "write=broker-serialized,atomic-temp-commit,if-absent-hardlink,expected-prior-digest|"
    "checkpoint=post-clean-exec,utf8-byte-order,double-pass-quiescence,maxfiles10000,maxbytes524288,maxduration60000,blobs+manifest,provider-snapshot-false|"
    "process=exact-startup-pre-post-baseline,subreaper,leftover-destroy-required|"
    "errors=authenticated,replay-safe,protocol-ambiguity-destroy-required|production-admission=false"
)
PROTOCOL_SHA256 = "sha256:" + hashlib.sha256(PROTOCOL_DESCRIPTION.encode("utf-8")).hexdigest()
REQUEST_SCHEMA = "sandboxes.e2b-guest-broker-request/v1"
RESPONSE_SCHEMA = "sandboxes.e2b-guest-broker-response/v1"
DIGEST_LENGTH = len("sha256:") + 64
REQUEST_KEYS = {
    "schema_version",
    "protocol_sha256",
    "session_binding_sha256",
    "request_id",
    "sequence",
    "nonce_sha256",
    "operation",
    "payload",
    "mac_sha256",
}
OPERATIONS = {"exec", "file_stat", "file_read", "file_write", "file_list", "checkpoint"}
SAFE_MODES = {0o600, 0o644, 0o700, 0o755}
ID_CHARACTERS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-")
O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
O_CLOEXEC = getattr(os, "O_CLOEXEC", 0)
O_NONBLOCK = getattr(os, "O_NONBLOCK", 0)
KEY_INIT_MAGIC = b"E2BGBK1\x00"
KEY_INIT_BYTES = 72


class BrokerError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message[:256]


def fail(code: str, message: str) -> NoReturn:
    raise BrokerError(code, message)


def canonical_json(value: Any) -> bytes:
    try:
        text = json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
        return text.encode("utf-8", "strict")
    except (TypeError, ValueError, UnicodeError) as exc:
        raise BrokerError("non_canonical_value", "value is not canonical JSON") from exc


def reject_float(_: str) -> NoReturn:
    fail("invalid_frame", "floating point values are forbidden")


def reject_constant(_: str) -> NoReturn:
    fail("invalid_frame", "non-finite numbers are forbidden")


def parse_integer(value: str) -> int:
    if len(value) > 16:
        fail("invalid_frame", "integer exceeds the canonical bound")
    parsed = int(value, 10)
    if parsed < -((1 << 53) - 1) or parsed > (1 << 53) - 1:
        fail("invalid_frame", "integer exceeds the canonical bound")
    return parsed


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail("invalid_frame", "duplicate object key")
        result[key] = value
    return result


def parse_canonical(line_without_lf: bytes) -> Any:
    try:
        text = line_without_lf.decode("utf-8", "strict")
        value = json.loads(
            text,
            object_pairs_hook=unique_object,
            parse_int=parse_integer,
            parse_float=reject_float,
            parse_constant=reject_constant,
        )
    except BrokerError:
        raise
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise BrokerError("invalid_frame", "malformed JSON frame") from exc
    if canonical_json(value) != line_without_lf:
        fail("invalid_frame", "frame is not canonical JSON")
    return value


def sha256_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def is_digest(value: Any) -> bool:
    if not isinstance(value, str) or len(value) != DIGEST_LENGTH or not value.startswith("sha256:"):
        return False
    return all(character in "0123456789abcdef" for character in value[7:])


def valid_id(value: Any) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= 128 and value[0].isalnum() and all(
        character in ID_CHARACTERS for character in value
    )


def bounded_int(value: Any, minimum: int, maximum: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum


def exact_keys(value: Any, keys: set[str]) -> bool:
    return isinstance(value, dict) and set(value.keys()) == keys


def path_value(value: Any) -> bool:
    try:
        return (
            isinstance(value, str)
            and 0 < len(value.encode("utf-8", "strict")) <= MAX_PATH_BYTES
            and "\x00" not in value
        )
    except UnicodeError:
        return False


def decode_base64(value: Any, maximum: int) -> bytes:
    if not isinstance(value, str) or len(value) > ((maximum + 2) // 3) * 4:
        fail("invalid_payload", "invalid base64 payload")
    try:
        decoded = base64.b64decode(value.encode("ascii"), validate=True)
    except (ValueError, UnicodeError) as exc:
        raise BrokerError("invalid_payload", "invalid base64 payload") from exc
    if len(decoded) > maximum or base64.b64encode(decoded).decode("ascii") != value:
        fail("invalid_payload", "base64 payload exceeds its bound")
    return decoded


def validate_payload(operation: str, payload: Any) -> None:
    if not isinstance(payload, dict):
        fail("invalid_payload", "payload must be an object")
    if operation == "exec":
        keys = {"exec_id", "argv", "cwd", "wall_timeout_ms", "idle_timeout_ms", "output_limit_bytes", "pids_limit"}
        if not exact_keys(payload, keys) or not valid_id(payload.get("exec_id")) or not path_value(payload.get("cwd")):
            fail("invalid_payload", "invalid exec payload")
        argv = payload.get("argv")
        if not isinstance(argv, list) or not 1 <= len(argv) <= 256:
            fail("invalid_payload", "argv must contain 1..256 arguments")
        argument_bytes = 0
        for argument in argv:
            if not isinstance(argument, str) or "\x00" in argument:
                fail("invalid_payload", "argv contains an invalid argument")
            try:
                size = len(argument.encode("utf-8", "strict"))
            except UnicodeError as exc:
                raise BrokerError("invalid_payload", "argv contains invalid Unicode") from exc
            if size > 16_384:
                fail("invalid_payload", "argv argument is too large")
            argument_bytes += size
        if not argv[0].startswith("/") or argument_bytes > 65_536:
            fail("invalid_payload", "argv executable must be absolute and argv bounded")
        if not bounded_int(payload.get("wall_timeout_ms"), 1, 3_600_000):
            fail("invalid_payload", "wall timeout is invalid")
        if not bounded_int(payload.get("idle_timeout_ms"), 1, 3_600_000):
            fail("invalid_payload", "idle timeout is invalid")
        if not bounded_int(payload.get("output_limit_bytes"), 1, MAX_BLOB_BYTES):
            fail("invalid_payload", "output bound is invalid")
        if not bounded_int(payload.get("pids_limit"), 1, 256):
            fail("invalid_payload", "process bound is invalid")
    elif operation == "file_stat":
        if not exact_keys(payload, {"path"}) or not path_value(payload.get("path")):
            fail("invalid_payload", "invalid stat payload")
    elif operation == "file_read":
        if not exact_keys(payload, {"path", "offset", "length", "max_bytes"}) or not path_value(payload.get("path")):
            fail("invalid_payload", "invalid read payload")
        if not bounded_int(payload.get("offset"), 0, 1_073_741_824) or not bounded_int(payload.get("length"), 0, MAX_BLOB_BYTES):
            fail("invalid_payload", "invalid read range")
        if not bounded_int(payload.get("max_bytes"), 0, MAX_BLOB_BYTES) or payload["length"] > payload["max_bytes"]:
            fail("invalid_payload", "read exceeds its bound")
    elif operation == "file_write":
        common = {"path", "content_base64", "mode", "max_bytes"}
        keys = set(payload.keys())
        precondition = keys - common
        if precondition not in ({"if_absent"}, {"expected_prior_sha256"}) or not path_value(payload.get("path")):
            fail("invalid_payload", "invalid write payload")
        if not bounded_int(payload.get("max_bytes"), 0, MAX_BLOB_BYTES) or payload.get("mode") not in SAFE_MODES:
            fail("invalid_payload", "invalid write limits")
        decode_base64(payload.get("content_base64"), payload["max_bytes"])
        if "if_absent" in payload and payload["if_absent"] is not True:
            fail("invalid_payload", "if_absent must be true")
        if "expected_prior_sha256" in payload and not is_digest(payload["expected_prior_sha256"]):
            fail("invalid_payload", "prior digest is invalid")
    elif operation == "file_list":
        if not exact_keys(payload, {"path", "depth", "limit"}) or not path_value(payload.get("path")):
            fail("invalid_payload", "invalid list payload")
        if not bounded_int(payload.get("depth"), 0, MAX_DEPTH) or not bounded_int(payload.get("limit"), 1, MAX_FILES):
            fail("invalid_payload", "invalid list limits")
    elif operation == "checkpoint":
        keys = {"max_files", "max_total_bytes", "max_file_bytes", "max_depth", "max_duration_ms"}
        if not exact_keys(payload, keys):
            fail("invalid_payload", "invalid checkpoint payload")
        if not bounded_int(payload.get("max_files"), 1, MAX_FILES):
            fail("invalid_payload", "checkpoint file bound is invalid")
        if not bounded_int(payload.get("max_total_bytes"), 0, MAX_BLOB_BYTES):
            fail("invalid_payload", "checkpoint byte bound is invalid")
        if not bounded_int(payload.get("max_file_bytes"), 0, MAX_BLOB_BYTES):
            fail("invalid_payload", "checkpoint file-size bound is invalid")
        if not bounded_int(payload.get("max_depth"), 0, MAX_DEPTH):
            fail("invalid_payload", "checkpoint depth bound is invalid")
        if not bounded_int(payload.get("max_duration_ms"), 1, MAX_DURATION_MS):
            fail("invalid_payload", "checkpoint duration bound is invalid")
    else:
        fail("invalid_payload", "unsupported operation")


@dataclass(frozen=True)
class Request:
    session_binding_sha256: str
    request_id: str
    sequence: int
    nonce_sha256: str
    operation: str
    payload: dict[str, Any]


class Workspace:
    def __init__(self, root: str, task_uid: int, task_gid: int) -> None:
        flags = os.O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        try:
            self.root_fd = os.open(root, flags)
        except OSError as exc:
            raise BrokerError("workspace_unavailable", "workspace root is not a safe directory") from exc
        self.root = root
        self.task_uid = task_uid
        self.task_gid = task_gid

    def close(self) -> None:
        os.close(self.root_fd)

    def segments(self, value: str, allow_root: bool = True) -> list[str]:
        if not path_value(value) or value.startswith("/"):
            fail("invalid_path", "workspace paths must be relative")
        if value == "." and allow_root:
            return []
        parts = value.split("/")
        if not parts or len(parts) > MAX_DEPTH or any(part in {"", ".", "..", ".git"} for part in parts):
            fail("invalid_path", "workspace path contains a forbidden segment")
        return parts

    def open_directory(self, parts: list[str]) -> int:
        current = os.dup(self.root_fd)
        os.set_inheritable(current, False)
        try:
            for part in parts:
                following = os.open(part, os.O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC, dir_fd=current)
                os.close(current)
                current = following
            return current
        except OSError as exc:
            os.close(current)
            if exc.errno == errno.ENOENT:
                raise BrokerError("not_found", "workspace path does not exist") from exc
            raise BrokerError("unsafe_file", "workspace path is not a safe directory") from exc

    def open_parent(self, parts: list[str]) -> tuple[int, str]:
        if not parts:
            fail("invalid_path", "operation requires a file path")
        return self.open_directory(parts[:-1]), parts[-1]

    def open_regular(self, path: str) -> tuple[int, os.stat_result]:
        parent, name = self.open_parent(self.segments(path, allow_root=False))
        try:
            descriptor = os.open(name, os.O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, dir_fd=parent)
        except OSError as exc:
            os.close(parent)
            if exc.errno == errno.ENOENT:
                raise BrokerError("not_found", "workspace file does not exist") from exc
            raise BrokerError("unsafe_file", "workspace path is not a safe regular file") from exc
        os.close(parent)
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            os.close(descriptor)
            fail("unsafe_file", "workspace path is not a regular file")
        if info.st_size > MAX_BLOB_BYTES:
            os.close(descriptor)
            fail("limit_exceeded", "workspace file exceeds the global bound")
        return descriptor, info

    def stat(self, path: str) -> dict[str, Any]:
        parts = self.segments(path)
        if not parts:
            info = os.fstat(self.root_fd)
            return {"path": ".", "type": "directory", "size": 0, "mode": stat.S_IMODE(info.st_mode), "sha256": sha256_bytes(b"")}
        parent, name = self.open_parent(parts)
        try:
            descriptor = os.open(name, os.O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, dir_fd=parent)
        except OSError as exc:
            os.close(parent)
            if exc.errno == errno.ENOENT:
                raise BrokerError("not_found", "workspace path does not exist") from exc
            raise BrokerError("unsafe_file", "workspace path is unsafe") from exc
        os.close(parent)
        try:
            info = os.fstat(descriptor)
            if stat.S_ISDIR(info.st_mode):
                return {"path": path, "type": "directory", "size": 0, "mode": stat.S_IMODE(info.st_mode), "sha256": sha256_bytes(b"")}
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BLOB_BYTES:
                fail("unsafe_file", "workspace path is not a bounded regular file")
            content = read_exact_file(descriptor, info.st_size)
            return {"path": path, "type": "file", "size": info.st_size, "mode": stat.S_IMODE(info.st_mode), "sha256": sha256_bytes(content)}
        finally:
            os.close(descriptor)

    def read(self, path: str, offset: int, length: int) -> dict[str, Any]:
        descriptor, info = self.open_regular(path)
        try:
            content = read_exact_file(descriptor, info.st_size)
        finally:
            os.close(descriptor)
        selected = content[offset : offset + length]
        return {
            "path": path,
            "offset": offset,
            "size": len(selected),
            "total_size": len(content),
            "sha256": sha256_bytes(content),
            "content_base64": base64.b64encode(selected).decode("ascii"),
        }

    def write(self, payload: dict[str, Any]) -> dict[str, Any]:
        path = payload["path"]
        content = decode_base64(payload["content_base64"], payload["max_bytes"])
        parent, name = self.open_parent(self.segments(path, allow_root=False))
        temporary = f".infinity-{secrets.token_hex(32)}.tmp"
        temporary_fd: int | None = None
        try:
            prior: bytes | None = None
            try:
                existing = os.open(name, os.O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, dir_fd=parent)
            except FileNotFoundError:
                existing = None
            except OSError as exc:
                raise BrokerError("unsafe_file", "write target is unsafe") from exc
            if existing is not None:
                try:
                    info = os.fstat(existing)
                    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BLOB_BYTES:
                        fail("unsafe_file", "write target is not a bounded regular file")
                    prior = read_exact_file(existing, info.st_size)
                finally:
                    os.close(existing)
            if "if_absent" in payload and prior is not None:
                fail("precondition_failed", "write target already exists")
            if "expected_prior_sha256" in payload and (prior is None or sha256_bytes(prior) != payload["expected_prior_sha256"]):
                fail("precondition_failed", "write prior digest does not match")
            temporary_fd = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                payload["mode"],
                dir_fd=parent,
            )
            write_all(temporary_fd, content)
            os.fchmod(temporary_fd, payload["mode"])
            if os.geteuid() == 0:
                os.fchown(temporary_fd, self.task_uid, self.task_gid)
            os.fsync(temporary_fd)
            os.close(temporary_fd)
            temporary_fd = None
            if "if_absent" in payload:
                try:
                    os.link(
                        temporary,
                        name,
                        src_dir_fd=parent,
                        dst_dir_fd=parent,
                        follow_symlinks=False,
                    )
                except FileExistsError as exc:
                    raise BrokerError("precondition_failed", "write target appeared before commit") from exc
                os.unlink(temporary, dir_fd=parent)
            else:
                os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
            os.fsync(parent)
            return {"path": path, "size": len(content), "mode": payload["mode"], "sha256": sha256_bytes(content)}
        finally:
            if temporary_fd is not None:
                os.close(temporary_fd)
            try:
                os.unlink(temporary, dir_fd=parent)
            except FileNotFoundError:
                pass
            os.close(parent)

    def list(self, path: str, depth: int, limit: int) -> dict[str, Any]:
        base = self.segments(path)
        directory = self.open_directory(base)
        entries: list[dict[str, Any]] = []
        try:
            self._walk(directory, base, depth, limit, entries, None)
        finally:
            os.close(directory)
        entries.sort(key=lambda entry: entry["path"].encode("utf-8", "strict"))
        return {"entries": entries}

    def checkpoint(self, payload: dict[str, Any]) -> dict[str, Any]:
        started = time.monotonic()
        files: list[dict[str, Any]] = []
        manifest: list[dict[str, Any]] = []
        file_observations: list[dict[str, Any]] = []
        directory_observations: list[dict[str, Any]] = []
        total = [0]
        root = os.dup(self.root_fd)
        os.set_inheritable(root, False)
        try:
            self._walk_checkpoint(
                root,
                [],
                0,
                payload,
                started,
                files,
                manifest,
                file_observations,
                directory_observations,
                total,
            )
        finally:
            os.close(root)
        self._revalidate_checkpoint(
            payload,
            started,
            file_observations,
            directory_observations,
        )
        paired = sorted(zip(files, manifest), key=lambda item: item[0]["path"].encode("utf-8", "strict"))
        files[:] = [item[0] for item in paired]
        manifest[:] = [item[1] for item in paired]
        manifest_bytes = canonical_json(manifest)
        file_basis = [{"path": item["path"], "sha256": item["sha256"], "size": item["size"]} for item in files]
        checkpoint_basis = {"manifest_sha256": sha256_bytes(manifest_bytes), "files": file_basis}
        return {
            "provider_snapshot_is_canonical": False,
            "file_count": len(files),
            "total_bytes": total[0],
            "manifest": manifest,
            "files": files,
            "manifest_sha256": checkpoint_basis["manifest_sha256"],
            "checkpoint_sha256": sha256_bytes(canonical_json(checkpoint_basis)),
        }

    def _walk(
        self,
        directory: int,
        prefix: list[str],
        remaining_depth: int,
        limit: int,
        entries: list[dict[str, Any]],
        deadline: float | None,
    ) -> None:
        if remaining_depth == 0:
            return
        for name in sorted(os.listdir(directory), key=lambda item: item.encode("utf-8", "surrogateescape")):
            if name == ".git":
                fail("invalid_path", ".git is forbidden")
            if deadline is not None and time.monotonic() > deadline:
                fail("duration_exceeded", "operation exceeded its duration bound")
            try:
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            except OSError as exc:
                raise BrokerError("unsafe_file", "workspace entry changed during traversal") from exc
            relative = "/".join([*prefix, name])
            if stat.S_ISLNK(info.st_mode) or not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                fail("unsafe_file", "workspace contains a symlink or special file")
            entries.append({
                "path": relative,
                "type": "directory" if stat.S_ISDIR(info.st_mode) else "file",
                "size": 0 if stat.S_ISDIR(info.st_mode) else info.st_size,
                "mode": stat.S_IMODE(info.st_mode),
            })
            if len(entries) > limit:
                fail("limit_exceeded", "list entry bound exceeded")
            if stat.S_ISDIR(info.st_mode):
                child = os.open(name, os.O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC, dir_fd=directory)
                try:
                    self._walk(child, [*prefix, name], remaining_depth - 1, limit, entries, deadline)
                finally:
                    os.close(child)

    def _walk_checkpoint(
        self,
        directory: int,
        prefix: list[str],
        depth: int,
        payload: dict[str, Any],
        started: float,
        files: list[dict[str, Any]],
        manifest: list[dict[str, Any]],
        file_observations: list[dict[str, Any]],
        directory_observations: list[dict[str, Any]],
        total: list[int],
    ) -> None:
        directory_before = os.fstat(directory)
        if depth > payload["max_depth"]:
            fail("limit_exceeded", "checkpoint depth bound exceeded")
        names = sorted(os.listdir(directory), key=lambda item: item.encode("utf-8", "surrogateescape"))
        for name in names:
            if (time.monotonic() - started) * 1000 > payload["max_duration_ms"]:
                fail("duration_exceeded", "checkpoint duration bound exceeded")
            if name == ".git":
                fail("invalid_path", ".git is forbidden")
            try:
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            except OSError as exc:
                raise BrokerError("unsafe_file", "workspace changed during checkpoint") from exc
            if stat.S_ISLNK(info.st_mode) or not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                fail("unsafe_file", "checkpoint contains a symlink or special file")
            path = "/".join([*prefix, name])
            if stat.S_ISDIR(info.st_mode):
                if depth >= payload["max_depth"]:
                    fail("limit_exceeded", "checkpoint depth bound exceeded")
                child = os.open(name, os.O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC, dir_fd=directory)
                try:
                    self._walk_checkpoint(
                        child,
                        [*prefix, name],
                        depth + 1,
                        payload,
                        started,
                        files,
                        manifest,
                        file_observations,
                        directory_observations,
                        total,
                    )
                finally:
                    os.close(child)
                continue
            if info.st_size > payload["max_file_bytes"]:
                fail("limit_exceeded", "checkpoint file-size bound exceeded")
            descriptor = os.open(name, os.O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, dir_fd=directory)
            try:
                opened = os.fstat(descriptor)
                if not stat.S_ISREG(opened.st_mode) or opened.st_dev != info.st_dev or opened.st_ino != info.st_ino or opened.st_size != info.st_size:
                    fail("unsafe_file", "checkpoint file changed before open")
                content = read_exact_file(descriptor, opened.st_size)
                after = os.fstat(descriptor)
                if after.st_size != opened.st_size or after.st_mtime_ns != opened.st_mtime_ns:
                    fail("workspace_not_quiescent", "checkpoint file changed while reading")
            finally:
                os.close(descriptor)
            total[0] += len(content)
            if total[0] > payload["max_total_bytes"] or len(files) + 1 > payload["max_files"]:
                fail("limit_exceeded", "checkpoint global bound exceeded")
            digest = sha256_bytes(content)
            files.append({"path": path, "size": len(content), "sha256": digest, "content_base64": base64.b64encode(content).decode("ascii")})
            manifest.append({"path": path, "size": len(content), "mode": stat.S_IMODE(opened.st_mode), "sha256": digest})
            file_observations.append({
                "path": path,
                "dev": opened.st_dev,
                "ino": opened.st_ino,
                "size": opened.st_size,
                "mode": stat.S_IMODE(opened.st_mode),
                "mtime_ns": opened.st_mtime_ns,
                "ctime_ns": opened.st_ctime_ns,
                "sha256": digest,
            })
        directory_after = os.fstat(directory)
        if (
            directory_before.st_mtime_ns != directory_after.st_mtime_ns
            or directory_before.st_ctime_ns != directory_after.st_ctime_ns
        ):
            fail("workspace_not_quiescent", "checkpoint directory changed during traversal")
        directory_observations.append({
            "path": "/".join(prefix) if prefix else ".",
            "dev": directory_after.st_dev,
            "ino": directory_after.st_ino,
            "mode": stat.S_IMODE(directory_after.st_mode),
            "mtime_ns": directory_after.st_mtime_ns,
            "ctime_ns": directory_after.st_ctime_ns,
            "names": names,
        })

    def _revalidate_checkpoint(
        self,
        payload: dict[str, Any],
        started: float,
        file_observations: list[dict[str, Any]],
        directory_observations: list[dict[str, Any]],
    ) -> None:
        for observation in directory_observations:
            if (time.monotonic() - started) * 1000 > payload["max_duration_ms"]:
                fail("duration_exceeded", "checkpoint revalidation exceeded its duration bound")
            descriptor = self.open_directory(self.segments(observation["path"]))
            try:
                current = os.fstat(descriptor)
                names = sorted(os.listdir(descriptor), key=lambda item: item.encode("utf-8", "surrogateescape"))
            finally:
                os.close(descriptor)
            if (
                current.st_dev != observation["dev"]
                or current.st_ino != observation["ino"]
                or stat.S_IMODE(current.st_mode) != observation["mode"]
                or current.st_mtime_ns != observation["mtime_ns"]
                or current.st_ctime_ns != observation["ctime_ns"]
                or names != observation["names"]
            ):
                fail("workspace_not_quiescent", "checkpoint directory changed before release")
        for observation in file_observations:
            if (time.monotonic() - started) * 1000 > payload["max_duration_ms"]:
                fail("duration_exceeded", "checkpoint revalidation exceeded its duration bound")
            descriptor, current = self.open_regular(observation["path"])
            try:
                content = read_exact_file(descriptor, current.st_size)
                after = os.fstat(descriptor)
            finally:
                os.close(descriptor)
            if (
                current.st_dev != observation["dev"]
                or current.st_ino != observation["ino"]
                or current.st_size != observation["size"]
                or stat.S_IMODE(current.st_mode) != observation["mode"]
                or current.st_mtime_ns != observation["mtime_ns"]
                or current.st_ctime_ns != observation["ctime_ns"]
                or after.st_mtime_ns != current.st_mtime_ns
                or after.st_ctime_ns != current.st_ctime_ns
                or sha256_bytes(content) != observation["sha256"]
            ):
                fail("workspace_not_quiescent", "checkpoint file changed before release")


def read_exact_file(descriptor: int, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    os.lseek(descriptor, 0, os.SEEK_SET)
    while remaining:
        chunk = os.read(descriptor, min(remaining, 64 * 1024))
        if not chunk:
            fail("workspace_not_quiescent", "file became shorter while reading")
        chunks.append(chunk)
        remaining -= len(chunk)
    if os.read(descriptor, 1):
        fail("workspace_not_quiescent", "file became longer while reading")
    return b"".join(chunks)


def write_all(descriptor: int, content: bytes) -> None:
    offset = 0
    while offset < len(content):
        written = os.write(descriptor, content[offset:])
        if written <= 0:
            fail("write_failed", "failed to write temporary file")
        offset += written


class Broker:
    def __init__(
        self,
        session_binding: str,
        mac_key: bytearray,
        workspace: Workspace,
        task_uid: int,
        task_gid: int,
        descendants_only_baseline: bool,
    ) -> None:
        self.session_binding = session_binding
        self.mac_key = mac_key
        self.workspace = workspace
        self.task_uid = task_uid
        self.task_gid = task_gid
        self.expected_sequence = 0
        self.seen_nonces: set[str] = set()
        self.stdout_lock = threading.Lock()
        self.active_lock = threading.Lock()
        self.active: dict[str, subprocess.Popen[bytes]] = {}
        self.known_exec: set[str] = set()
        self.pending_operations = threading.BoundedSemaphore(MAX_PENDING_OPERATIONS)
        self.descendants_only_baseline = descendants_only_baseline
        self.process_baseline = process_snapshot(descendants_only_baseline)
        self.process_baseline_sha256 = process_snapshot_sha256(self.process_baseline)
        self.exec_consumed = False
        self.checkpoint_eligible = False
        self.destroy_required = False
        self.taint_reason: str | None = None
        self.protocol_error_counter = 0
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="broker-serial")

    def taint(self, reason: str) -> None:
        self.destroy_required = True
        self.checkpoint_eligible = False
        if self.taint_reason is None:
            self.taint_reason = reason

    def assert_quiescent(self) -> str:
        current = process_snapshot(self.descendants_only_baseline)
        current_sha256 = process_snapshot_sha256(current)
        if current != self.process_baseline:
            self.taint("process_baseline_mismatch")
            fail("process_baseline_mismatch", "guest process baseline does not match")
        return current_sha256

    def request_mac(self, basis: dict[str, Any]) -> str:
        return "sha256:" + hmac.new(self.mac_key, canonical_json(basis), hashlib.sha256).hexdigest()

    def parse_request(self, raw: bytes) -> Request:
        if len(raw) < 2 or len(raw) > MAX_FRAME_BYTES or not raw.endswith(b"\n") or b"\n" in raw[:-1] or b"\r" in raw[:-1]:
            fail("invalid_frame", "request framing is invalid")
        value = parse_canonical(raw[:-1])
        if not exact_keys(value, REQUEST_KEYS):
            fail("invalid_frame", "request frame has unknown or missing fields")
        if value["schema_version"] != REQUEST_SCHEMA or value["protocol_sha256"] != PROTOCOL_SHA256:
            fail("protocol_mismatch", "request protocol does not match")
        if value["session_binding_sha256"] != self.session_binding or not is_digest(value["nonce_sha256"]):
            fail("binding_mismatch", "request session binding is invalid")
        if not valid_id(value["request_id"]) or not bounded_int(value["sequence"], 0, (1 << 53) - 1):
            fail("invalid_frame", "request identity is invalid")
        if value["operation"] not in OPERATIONS or not is_digest(value["mac_sha256"]):
            fail("invalid_frame", "request operation or MAC is invalid")
        basis = dict(value)
        received_mac = basis.pop("mac_sha256")
        if not hmac.compare_digest(received_mac, self.request_mac(basis)):
            raise BoundBrokerError.from_value("authentication_failed", "request MAC is invalid", value)
        validate_payload(value["operation"], value["payload"])
        request = Request(
            session_binding_sha256=value["session_binding_sha256"],
            request_id=value["request_id"],
            sequence=value["sequence"],
            nonce_sha256=value["nonce_sha256"],
            operation=value["operation"],
            payload=value["payload"],
        )
        if request.sequence < self.expected_sequence or request.nonce_sha256 in self.seen_nonces:
            raise BoundBrokerError("replay", "request sequence or nonce was already consumed", request)
        if request.sequence != self.expected_sequence:
            raise BoundBrokerError("out_of_order", "request sequence is not the next sequence", request)
        if self.expected_sequence >= MAX_SESSION_REQUESTS:
            raise BoundBrokerError("session_limit", "broker session request bound reached", request)
        self.expected_sequence += 1
        self.seen_nonces.add(request.nonce_sha256)
        return request

    def response_basis(self, request: Request, ok: bool, body: dict[str, Any]) -> dict[str, Any]:
        basis: dict[str, Any] = {
            "schema_version": RESPONSE_SCHEMA,
            "protocol_sha256": PROTOCOL_SHA256,
            "session_binding_sha256": request.session_binding_sha256,
            "request_id": request.request_id,
            "sequence": request.sequence,
            "nonce_sha256": request.nonce_sha256,
            "operation": request.operation,
            "ok": ok,
        }
        basis["result" if ok else "error"] = body
        return basis

    def send(self, request: Request, ok: bool, body: dict[str, Any]) -> None:
        if not ok:
            self.taint(str(body.get("code", "error_response")))
        basis = self.response_basis(request, ok, body)
        frame = dict(basis)
        frame["mac_sha256"] = self.request_mac(basis)
        encoded = canonical_json(frame) + b"\n"
        if len(encoded) > MAX_FRAME_BYTES:
            basis = self.response_basis(request, False, {"code": "response_too_large", "message": "response exceeds protocol frame bound"})
            frame = dict(basis)
            frame["mac_sha256"] = self.request_mac(basis)
            encoded = canonical_json(frame) + b"\n"
        with self.stdout_lock:
            sys.stdout.buffer.write(encoded)
            sys.stdout.buffer.flush()

    def protocol_error(self, code: str, message: str) -> None:
        counter = self.protocol_error_counter
        self.protocol_error_counter += 1
        request = Request(
            session_binding_sha256=self.session_binding,
            request_id=f"protocol-error-{counter}",
            sequence=self.expected_sequence,
            nonce_sha256=sha256_bytes(
                f"protocol-error:{self.session_binding}:{self.expected_sequence}:{counter}:{code}".encode("utf-8")
            ),
            operation="protocol_error",
            payload={},
        )
        self.send(request, False, {"code": code[:64], "message": message[:256]})

    def startup(self, artifact: dict[str, Any]) -> None:
        request = Request(
            session_binding_sha256=self.session_binding,
            request_id="startup",
            sequence=0,
            nonce_sha256=sha256_bytes(f"startup:{self.session_binding}".encode("utf-8")),
            operation="startup",
            payload={},
        )
        result = dict(artifact)
        result.update({
            "process_baseline_sha256": self.process_baseline_sha256,
            "unexpected_process_count": 0,
            "exec_limit": 1,
            "exec_cancel": False,
            "resume": False,
            "checkpoint_eligible": False,
            "destroy_required": False,
            "production_admission": False,
        })
        self.send(request, True, result)

    def submit(self, request: Request) -> None:
        if self.destroy_required:
            self.send(request, False, {"code": "destroy_required", "message": "broker session is permanently tainted"})
            return
        if not self.pending_operations.acquire(blocking=False):
            self.send(request, False, {"code": "capacity_exceeded", "message": "broker operation queue is full"})
            return
        if request.operation == "exec":
            with self.active_lock:
                if self.exec_consumed:
                    self.taint("multiple_exec_forbidden")
                    self.send(request, False, {"code": "destroy_required", "message": "V1 permits one foreground exec for the sandbox lifetime"})
                    self.pending_operations.release()
                    return
                self.exec_consumed = True
                self.known_exec.add(request.payload["exec_id"])
        self.executor.submit(self.handle_serial, request)

    def handle_serial(self, request: Request) -> None:
        try:
            self.assert_quiescent()
            if request.operation == "exec":
                result = self.exec(request.payload)
            elif request.operation == "file_stat":
                result = self.workspace.stat(request.payload["path"])
            elif request.operation == "file_read":
                result = self.workspace.read(request.payload["path"], request.payload["offset"], request.payload["length"])
            elif request.operation == "file_write":
                result = self.workspace.write(request.payload)
            elif request.operation == "file_list":
                result = self.workspace.list(request.payload["path"], request.payload["depth"], request.payload["limit"])
            elif request.operation == "checkpoint":
                if not self.checkpoint_eligible:
                    fail("checkpoint_not_eligible", "checkpoint requires one clean foreground exec")
                with self.active_lock:
                    if self.active:
                        fail("workspace_not_quiescent", "an execution is still active")
                result = self.workspace.checkpoint(request.payload)
                quiescence = self.assert_quiescent()
                result.update({
                    "process_baseline_sha256": self.process_baseline_sha256,
                    "process_quiescence_sha256": quiescence,
                    "unexpected_process_count": 0,
                })
            else:
                fail("unsupported_operation", "operation is not supported")
            self.send(request, True, result)
        except BrokerError as exc:
            self.send(request, False, {"code": exc.code, "message": exc.message})
        except Exception:
            self.send(request, False, {"code": "internal_error", "message": "broker operation failed closed"})
        finally:
            if request.operation == "exec":
                with self.active_lock:
                    self.known_exec.discard(request.payload["exec_id"])
            self.pending_operations.release()

    def exec(self, payload: dict[str, Any]) -> dict[str, Any]:
        exec_id = payload["exec_id"]
        started = time.monotonic()
        cwd_fd = self.workspace.open_directory(self.workspace.segments(payload["cwd"]))
        safe_environment = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": self.workspace.root,
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "TMPDIR": "/tmp",
        }
        status_read, status_write = os.pipe2(O_CLOEXEC)
        helper_argv = [
            sys.executable,
            os.path.realpath(__file__),
            "--exec-child",
            str(cwd_fd),
            str(self.task_uid),
            str(self.task_gid),
            str(payload["pids_limit"]),
            str(status_write),
            "--",
            *payload["argv"],
        ]
        try:
            process = subprocess.Popen(
                helper_argv,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=safe_environment,
                close_fds=True,
                pass_fds=(cwd_fd, status_write),
            )
        except (OSError, subprocess.SubprocessError):
            os.close(cwd_fd)
            os.close(status_read)
            os.close(status_write)
            self.taint("spawn_failed")
            quiescence = self.assert_quiescent()
            return exec_result("spawn_failed", None, b"", b"", False, started, self.process_baseline_sha256, quiescence, True, False)
        os.close(cwd_fd)
        os.close(status_write)
        helper_status = selectors.DefaultSelector()
        helper_status.register(status_read, selectors.EVENT_READ)
        helper_events = helper_status.select(1.0)
        helper_status.close()
        if not helper_events:
            os.close(status_read)
            terminate_group(process, 0)
            process.wait(timeout=1)
            self.taint("spawn_handshake_timeout")
            quiescence = self.assert_quiescent()
            return exec_result("spawn_failed", None, b"", b"", False, started, self.process_baseline_sha256, quiescence, True, False)
        helper_failure = os.read(status_read, 8)
        os.close(status_read)
        if helper_failure:
            process.wait(timeout=1)
            self.taint("spawn_failed")
            quiescence = self.assert_quiescent()
            return exec_result("spawn_failed", process.returncode, b"", b"", False, started, self.process_baseline_sha256, quiescence, True, False)
        with self.active_lock:
            self.active[exec_id] = process
        stdout = bytearray()
        stderr = bytearray()
        output_limit = payload["output_limit_bytes"]
        status = "exited"
        output_truncated = False
        last_activity = time.monotonic()
        termination_deadline: float | None = None
        selector = selectors.DefaultSelector()
        assert process.stdout is not None and process.stderr is not None
        selector.register(process.stdout, selectors.EVENT_READ, stdout)
        selector.register(process.stderr, selectors.EVENT_READ, stderr)

        def terminate(reason: str) -> None:
            nonlocal status, termination_deadline
            if termination_deadline is not None:
                return
            status = reason
            terminate_group(process, 0)
            termination_deadline = time.monotonic() + 0.5

        def consume(key: selectors.SelectorKey) -> None:
            nonlocal last_activity, output_truncated
            try:
                chunk = os.read(key.fd, 64 * 1024)
            except BlockingIOError:
                return
            if not chunk:
                selector.unregister(key.fileobj)
                return
            last_activity = time.monotonic()
            target: bytearray = key.data
            remaining = max(0, output_limit - len(stdout) - len(stderr))
            if remaining:
                target.extend(chunk[:remaining])
            if len(chunk) > remaining:
                output_truncated = True
                terminate("output_limit")

        try:
            while selector.get_map():
                now = time.monotonic()
                if termination_deadline is not None and now >= termination_deadline:
                    output_truncated = True
                    break
                if termination_deadline is None and (now - started) * 1000 >= payload["wall_timeout_ms"]:
                    terminate("wall_timeout")
                elif termination_deadline is None and (now - last_activity) * 1000 >= payload["idle_timeout_ms"]:
                    terminate("idle_timeout")
                timeout = min(0.05, payload["wall_timeout_ms"] / 1000, payload["idle_timeout_ms"] / 1000)
                events = selector.select(timeout)
                for key, _ in events:
                    consume(key)
                if process.poll() is not None and not events:
                    for key in list(selector.get_map().values()):
                        consume(key)
                    if termination_deadline is None:
                        terminate_group(process, 0)
                        termination_deadline = time.monotonic() + 0.5
            try:
                exit_code = process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                terminate_group(process, 0)
                exit_code = process.wait(timeout=1)
        finally:
            terminate_group(process, 0)
            selector.close()
            process.stdout.close()
            process.stderr.close()
            with self.active_lock:
                self.active.pop(exec_id, None)
        reap_adopted_children()
        abnormal = status != "exited" or exit_code != 0 or output_truncated
        if abnormal:
            self.taint(f"exec_{status}")
        quiescence = self.assert_quiescent()
        if not abnormal:
            self.checkpoint_eligible = True
        return exec_result(
            status,
            exit_code,
            bytes(stdout),
            bytes(stderr),
            output_truncated,
            started,
            self.process_baseline_sha256,
            quiescence,
            self.destroy_required,
            self.checkpoint_eligible,
        )

    def close(self) -> None:
        self.executor.shutdown(wait=True, cancel_futures=False)
        for index in range(len(self.mac_key)):
            self.mac_key[index] = 0


class BoundBrokerError(BrokerError):
    def __init__(self, code: str, message: str, request: Request) -> None:
        super().__init__(code, message)
        self.request = request

    @classmethod
    def from_value(cls, code: str, message: str, value: dict[str, Any]) -> "BoundBrokerError":
        operation = value.get("operation") if value.get("operation") in OPERATIONS else "protocol_error"
        request = Request(
            session_binding_sha256=value.get("session_binding_sha256") if is_digest(value.get("session_binding_sha256")) else "sha256:" + ("0" * 64),
            request_id=value.get("request_id") if valid_id(value.get("request_id")) else "protocol-error",
            sequence=value.get("sequence") if bounded_int(value.get("sequence"), 0, (1 << 53) - 1) else 0,
            nonce_sha256=value.get("nonce_sha256") if is_digest(value.get("nonce_sha256")) else "sha256:" + ("0" * 64),
            operation=operation,
            payload={},
        )
        return cls(code, message, request)


def terminate_group(process: subprocess.Popen[bytes], grace_ms: int) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    deadline = time.monotonic() + grace_ms / 1000
    while time.monotonic() < deadline:
        time.sleep(0.005)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def process_table() -> dict[int, tuple[int, int]]:
    result: dict[int, tuple[int, int]] = {}
    try:
        names = os.listdir("/proc")
    except OSError:
        return result
    for name in names:
        if not name.isdigit():
            continue
        pid = int(name, 10)
        try:
            with open(f"/proc/{pid}/stat", "rb", buffering=0) as handle:
                stat_line = handle.read(4096)
            suffix = stat_line.rsplit(b")", 1)[1].split()
            result[pid] = (int(suffix[1], 10), int(suffix[19], 10))
        except (OSError, IndexError, ValueError):
            continue
    return result


def task_process_ids(root_pid: int) -> set[int]:
    table = process_table()
    broker_pid = os.getpid()
    selected = {root_pid}
    selected.update(pid for pid, (parent, _) in table.items() if parent == broker_pid)
    changed = True
    while changed:
        changed = False
        for pid, (parent, _) in table.items():
            if parent in selected and pid not in selected:
                selected.add(pid)
                changed = True
    selected.discard(broker_pid)
    return {pid for pid in selected if pid in table or pid == root_pid}


def process_snapshot(descendants_only: bool) -> list[dict[str, int]]:
    table = process_table()
    broker_pid = os.getpid()
    if descendants_only:
        selected: set[int] = set()
        changed = True
        while changed:
            changed = False
            for pid, (parent, _) in table.items():
                if parent == broker_pid or parent in selected:
                    if pid not in selected:
                        selected.add(pid)
                        changed = True
    else:
        selected = set(table.keys())
        selected.discard(broker_pid)
    return [
        {"pid": pid, "ppid": table[pid][0], "start_ticks": table[pid][1]}
        for pid in sorted(selected)
    ]


def process_snapshot_sha256(snapshot: list[dict[str, int]]) -> str:
    return sha256_bytes(canonical_json(snapshot))


def reap_adopted_children() -> None:
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid <= 0:
            return


def enable_child_subreaper() -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        fail("subreaper_unavailable", "guest kernel cannot enforce task descendant adoption")


def inspect_executed_artifact(
    descriptor: int,
    path: str,
    expected_sha256: str | None,
    production: bool,
    verified_fd: bool,
) -> dict[str, Any]:
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size < 1 or info.st_size > 262_144:
            fail("artifact_verification_failed", "broker artifact is not a bounded regular file")
        if production and (info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o500):
            fail("artifact_verification_failed", "broker artifact ownership or mode is invalid")
        os.lseek(descriptor, 0, os.SEEK_SET)
        content = read_exact_file(descriptor, info.st_size)
        after = os.fstat(descriptor)
        if (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mode,
            after.st_uid,
            after.st_gid,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ) != (
            info.st_dev,
            info.st_ino,
            info.st_size,
            info.st_mode,
            info.st_uid,
            info.st_gid,
            info.st_mtime_ns,
            info.st_ctime_ns,
        ):
            fail("artifact_verification_failed", "broker artifact changed during verification")
        artifact_sha256 = sha256_bytes(content)
        if expected_sha256 is not None and artifact_sha256 != expected_sha256:
            fail("artifact_verification_failed", "broker artifact digest does not match")
        path_info = os.stat(path, follow_symlinks=False)
        if path_info.st_dev != info.st_dev or path_info.st_ino != info.st_ino or stat.S_ISLNK(path_info.st_mode):
            fail("artifact_verification_failed", "broker path does not name the executed inode")
        return {
            "artifact_sha256": artifact_sha256,
            "path": path,
            "device": info.st_dev,
            "inode": info.st_ino,
            "size": info.st_size,
            "mode": stat.S_IMODE(info.st_mode),
            "uid": info.st_uid,
            "gid": info.st_gid,
            "verified_fd": verified_fd,
        }
    except OSError as exc:
        raise BrokerError("artifact_verification_failed", "broker artifact verification failed") from exc


def exec_result(
    status: str,
    exit_code: int | None,
    stdout: bytes,
    stderr: bytes,
    truncated: bool,
    started: float,
    process_baseline_sha256: str,
    process_quiescence_sha256: str,
    destroy_required: bool,
    checkpoint_eligible: bool,
) -> dict[str, Any]:
    return {
        "status": status,
        "exit_code": exit_code,
        "stdout_base64": base64.b64encode(stdout).decode("ascii"),
        "stderr_base64": base64.b64encode(stderr).decode("ascii"),
        "output_truncated": truncated,
        "duration_ms": max(0, int((time.monotonic() - started) * 1000)),
        "process_baseline_sha256": process_baseline_sha256,
        "process_quiescence_sha256": process_quiescence_sha256,
        "unexpected_process_count": 0,
        "destroy_required": destroy_required,
        "checkpoint_eligible": checkpoint_eligible,
    }


def read_key(descriptor: int) -> bytearray:
    chunks: list[bytes] = []
    total = 0
    try:
        while True:
            chunk = os.read(descriptor, 65 - total)
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > 64:
                fail("invalid_mac_key", "MAC key is too large")
    finally:
        os.close(descriptor)
    key = b"".join(chunks)
    if not 32 <= len(key) <= 64:
        fail("invalid_mac_key", "MAC key must contain 32..64 bytes")
    return bytearray(key)


def read_exact_stream(stream: BinaryIO, length: int) -> bytes:
    chunks: list[bytes] = []
    remaining = length
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            fail("invalid_key_init", "session-key initialization was truncated")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_session_key_init(stream: BinaryIO) -> tuple[str, bytearray]:
    record = bytearray(read_exact_stream(stream, KEY_INIT_BYTES))
    try:
        if not hmac.compare_digest(record[: len(KEY_INIT_MAGIC)], KEY_INIT_MAGIC):
            fail("invalid_key_init", "session-key initialization magic is invalid")
        binding = "sha256:" + bytes(record[len(KEY_INIT_MAGIC) : len(KEY_INIT_MAGIC) + 32]).hex()
        key = bytearray(record[len(KEY_INIT_MAGIC) + 32 :])
        if len(key) != 32 or not is_digest(binding):
            fail("invalid_key_init", "session-key initialization is invalid")
        return binding, key
    finally:
        for index in range(len(record)):
            record[index] = 0


def resolve_task_identity(allow_non_root: bool) -> tuple[int, int]:
    if os.geteuid() == 0:
        try:
            account = pwd.getpwnam("user")
        except KeyError:
            account = pwd.getpwnam("nobody")
        if account.pw_uid == 0:
            fail("invalid_task_identity", "task identity must be unprivileged")
        return account.pw_uid, account.pw_gid
    if not allow_non_root:
        fail("root_required", "production broker must start as root")
    return os.geteuid(), os.getegid()


def exec_child(arguments: list[str]) -> int:
    if len(arguments) < 7 or arguments[5] != "--":
        return 64
    try:
        cwd_fd = int(arguments[0], 10)
        task_uid = int(arguments[1], 10)
        task_gid = int(arguments[2], 10)
        pids_limit = int(arguments[3], 10)
        status_fd = int(arguments[4], 10)
    except ValueError:
        return 64
    task_argv = arguments[6:]

    def child_failure(code: int) -> int:
        try:
            os.write(status_fd, bytes([code & 0xFF]))
        except OSError:
            pass
        return code

    if not task_argv or not task_argv[0].startswith("/") or not 1 <= pids_limit <= 256:
        return child_failure(64)
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
            return child_failure(71)
        original_parent = os.getppid()
        os.setsid()
        os.fchdir(cwd_fd)
        os.set_inheritable(cwd_fd, False)
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        current_nofile = resource.getrlimit(resource.RLIMIT_NOFILE)
        nofile_limit = 128 if current_nofile[1] == resource.RLIM_INFINITY else min(128, current_nofile[1])
        resource.setrlimit(resource.RLIMIT_NOFILE, (nofile_limit, nofile_limit))
        current_nproc = resource.getrlimit(resource.RLIMIT_NPROC)
        nproc_limit = pids_limit if current_nproc[1] == resource.RLIM_INFINITY else min(pids_limit, current_nproc[1])
        resource.setrlimit(resource.RLIMIT_NPROC, (nproc_limit, nproc_limit))
        os.umask(0o077)
        if os.geteuid() == 0:
            os.setgroups([])
            os.setgid(task_gid)
            os.setuid(task_uid)
        if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:  # PR_SET_PDEATHSIG; reset after credential drop
            return child_failure(71)
        if os.getppid() != original_parent or original_parent == 1:
            return child_failure(71)
        safe_environment = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": os.getcwd(),
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "TMPDIR": "/tmp",
        }
        os.set_inheritable(status_fd, False)
        os.execve(task_argv[0], task_argv, safe_environment)
    except (OSError, ValueError):
        return child_failure(71)
    return child_failure(71)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
    parser.add_argument("--stdio", action="store_true")
    parser.add_argument("--session-binding")
    parser.add_argument("--mac-key-fd", type=int)
    parser.add_argument("--allow-non-root-for-test", action="store_true")
    parser.add_argument("--test-workspace-root")
    parser.add_argument("--executed-fd", type=int)
    parser.add_argument("--expected-artifact-sha256")
    parser.add_argument("--test-executed-path")
    args = parser.parse_args()
    if not args.stdio:
        fail("invalid_arguments", "stdio mode is required")
    if args.mac_key_fd is not None:
        if not args.allow_non_root_for_test or not is_digest(args.session_binding) or not 3 <= args.mac_key_fd <= 255:
            fail("invalid_arguments", "key-descriptor mode is test-only and requires a session binding")
    elif args.session_binding is not None:
        fail("invalid_arguments", "live session binding is carried only by the stdin key initialization")
    if args.test_workspace_root is not None and not args.allow_non_root_for_test:
        fail("invalid_arguments", "test workspace override requires explicit test mode")
    if args.allow_non_root_for_test:
        has_test_fd = args.executed_fd is not None or args.expected_artifact_sha256 is not None or args.test_executed_path is not None
        if has_test_fd and not (
            bounded_int(args.executed_fd, 3, 255)
            and is_digest(args.expected_artifact_sha256)
            and isinstance(args.test_executed_path, str)
            and args.test_executed_path.startswith("/")
        ):
            fail("invalid_arguments", "test verified-fd mode requires a complete explicit test identity")
    elif (
        not bounded_int(args.executed_fd, 3, 255)
        or not is_digest(args.expected_artifact_sha256)
        or args.test_executed_path is not None
    ):
        fail("invalid_arguments", "live mode requires only the inherited production artifact descriptor")
    return args


def run() -> int:
    args = arguments()
    enable_child_subreaper()
    task_uid, task_gid = resolve_task_identity(args.allow_non_root_for_test)
    workspace_path = args.test_workspace_root if args.test_workspace_root is not None else "/workspace"
    stream: BinaryIO = sys.stdin.buffer
    if args.mac_key_fd is None:
        session_binding, key = read_session_key_init(stream)
    else:
        session_binding, key = args.session_binding, read_key(args.mac_key_fd)
    if args.allow_non_root_for_test and args.executed_fd is None:
        artifact_path = os.path.realpath(__file__)
        artifact_fd = os.open(artifact_path, os.O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        try:
            artifact = inspect_executed_artifact(artifact_fd, artifact_path, None, False, False)
        finally:
            os.close(artifact_fd)
    elif args.allow_non_root_for_test:
        artifact = inspect_executed_artifact(
            args.executed_fd,
            args.test_executed_path,
            args.expected_artifact_sha256,
            False,
            True,
        )
    else:
        artifact = inspect_executed_artifact(
            args.executed_fd,
            "/opt/hasna/bin/sandboxes-broker-v1",
            args.expected_artifact_sha256,
            True,
            True,
        )
    workspace = Workspace(workspace_path, task_uid, task_gid)
    broker = Broker(
        session_binding,
        key,
        workspace,
        task_uid,
        task_gid,
        descendants_only_baseline=args.allow_non_root_for_test,
    )
    try:
        broker.startup(artifact)
        while True:
            raw = stream.readline(MAX_FRAME_BYTES + 1)
            if raw == b"":
                break
            if len(raw) > MAX_FRAME_BYTES:
                broker.protocol_error("frame_too_large", "request exceeds protocol frame bound")
                break
            if raw.startswith(KEY_INIT_MAGIC):
                broker.protocol_error("key_init_replay", "session-key initialization may occur only once")
                break
            try:
                request = broker.parse_request(raw)
            except BoundBrokerError as exc:
                broker.taint(exc.code)
                broker.send(exc.request, False, {"code": exc.code, "message": exc.message})
                if exc.code == "session_limit":
                    break
                continue
            except BrokerError as exc:
                broker.taint(exc.code)
                broker.protocol_error(exc.code, exc.message)
                continue
            broker.submit(request)
        broker.close()
        return 0
    finally:
        workspace.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--exec-child":
        raise SystemExit(exec_child(sys.argv[2:]))
    else:
        try:
            raise SystemExit(run())
        except BrokerError:
            raise SystemExit(64)
