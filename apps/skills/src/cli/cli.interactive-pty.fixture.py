"""Bounded real controlling-terminal journey; report only fixed observations."""
import errno
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time


def main():
    config = json.loads(sys.stdin.buffer.read(65537))
    pid, master = pty.fork()
    if pid == 0:
        os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
    output = b""
    completed = cursor = 0
    status = None
    raw = False
    deadline = time.monotonic() + 12
    try:
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 100, 0, 0))
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.02)[0]:
                try:
                    output += os.read(master, 4096)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
            if len(output) > 30000:
                break
            text = re.sub(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))", "", output.decode(errors="replace"))
            ready = not bool(termios.tcgetattr(master)[3] & termios.ICANON)
            raw = raw or ready
            if ready and completed < len(config["steps"]):
                step = config["steps"][completed]
                at = text.find(step["waitFor"], cursor)
                if at >= 0:
                    cursor = at + len(step["waitFor"])
                    os.write(master, step["send"].encode())
                    completed += 1
            observed, result = os.waitpid(pid, os.WNOHANG)
            if observed:
                status = result
                break
        code = os.waitstatus_to_exitcode(status) if status is not None else None
        passed = code == 0 and raw and completed == len(config["steps"]) and len(output) <= 30000
        print(json.dumps({"passed": passed, "exitCode": code, "steps": completed,
                          "rawInputObserved": raw, "outputBytes": len(output)}))
        return 0 if passed else 1
    finally:
        if status is None:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)
        os.close(master)


if __name__ == "__main__":
    sys.exit(main())
