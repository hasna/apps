"""Copy only bounded, owned top-level release logs/XML into a fresh artifact root."""
import os
from pathlib import Path
import re
import stat
import sys

MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 96 * 1024 * 1024
MAX_FILES = 16
MAX_RUNS = 4
MAX_DIRECTORY_ENTRIES = 64
RUN_NAME = re.compile(r"recordings-release-gate-[A-Za-z0-9_-]+\Z")
FILE_NAME = re.compile(r"[a-z][a-z0-9-]*\.(?:log|xml)\Z")
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


def names(directory):
    result = []
    with os.scandir(directory) as entries:
        for item in entries:
            result.append(item.name)
            if len(result) > MAX_DIRECTORY_ENTRIES:
                raise ValueError("too many directory entries")
    return sorted(result)


def owned_directory(directory):
    info = os.fstat(directory)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("diagnostic roots must be private owned directories")


def collect(source, destination):
    source, destination = Path(source), Path(destination)
    if (not source.is_absolute() or source.resolve(strict=True) != source
            or not destination.is_absolute() or destination.parent.resolve(strict=True) != destination.parent):
        raise ValueError("canonical absolute directories required")
    if destination.exists() or destination.is_symlink():
        raise FileExistsError("diagnostic output must be new")
    payloads = []
    total = 0
    source_fd = os.open(source, DIRECTORY_FLAGS)
    try:
        owned_directory(source_fd)
        runs = [name for name in names(source_fd) if RUN_NAME.fullmatch(name)]
        if len(runs) > MAX_RUNS: raise ValueError("too many release runs")
        for run in runs:
            try: run_fd = os.open(run, DIRECTORY_FLAGS, dir_fd=source_fd)
            except OSError: raise ValueError("unsafe release directory") from None
            try:
                owned_directory(run_fd)
                for name in names(run_fd):
                    if not FILE_NAME.fullmatch(name): continue
                    try: fd = os.open(name, FILE_FLAGS, dir_fd=run_fd)
                    except OSError: raise ValueError("unsafe diagnostic file") from None
                    try:
                        before = os.fstat(fd)
                        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                                or before.st_nlink != 1 or before.st_size > MAX_FILE_BYTES):
                            raise ValueError("unsafe or oversized diagnostic file")
                        total += before.st_size
                        if total > MAX_TOTAL_BYTES or len(payloads) >= MAX_FILES:
                            raise ValueError("diagnostic budget exceeded")
                        chunks, remaining = [], before.st_size
                        while remaining:
                            chunk = os.read(fd, min(remaining, 1024 * 1024))
                            if not chunk: raise ValueError("diagnostic file shortened during read")
                            chunks.append(chunk)
                            remaining -= len(chunk)
                        after = os.fstat(fd)
                        if any(getattr(before, key) != getattr(after, key) for key in
                               ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_nlink")):
                            raise ValueError("diagnostic changed during read")
                        payloads.append((run, name, b"".join(chunks)))
                    finally: os.close(fd)
            finally: os.close(run_fd)
    finally: os.close(source_fd)
    destination.mkdir(mode=0o700)
    for run, name, data in payloads:
        target = destination / run
        target.mkdir(mode=0o700, exist_ok=True)
        fd = os.open(target / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as output: output.write(data)
    return len(payloads), total


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3: raise ValueError("source and destination required")
        count, size = collect(sys.argv[1], sys.argv[2])
        print(f"Recordings diagnostics: retained {count} top-level log/XML files ({size} bytes).")
    except (OSError, ValueError):
        print("Recordings diagnostic collection refused unsafe or oversized input.", file=sys.stderr)
        sys.exit(1)
