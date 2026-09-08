"""Owned PTY driver. Secrets enter through stdin and never appear in its report."""
import json
import os
import pty
import select
import signal
import subprocess
import sys
import termios
import time
import urllib.parse
import urllib.request


def main():
    config = json.loads(sys.stdin.buffer.read(65537))
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)
    child = None
    output = b""
    cursor = 0
    completed = 0
    checkpoints = 0
    deadline = time.monotonic() + 12
    try:
        child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        for step in config["steps"]:
            expected = step["waitFor"].encode()
            while expected not in output[cursor:]:
                if time.monotonic() >= deadline or child.poll() is not None:
                    raise RuntimeError("prompt-refused-or-timeout")
                if select.select([master], [], [], 0.05)[0]:
                    output += os.read(master, 4096)
                    if len(output) > 30000:
                        raise RuntimeError("output-bound")
            cursor = output.index(expected, cursor) + len(expected)
            if "checkUrl" in step:
                target = urllib.parse.urlsplit(step["checkUrl"])
                if target.scheme != "http" or target.hostname != "127.0.0.1" or target.path != "/owned-pty-checkpoint" or target.username or target.password or target.query or target.fragment:
                    raise RuntimeError("invalid-owned-checkpoint")
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                with opener.open(step["checkUrl"], timeout=2) as response:
                    data = response.read(4097)
                if len(data) > 4096 or json.loads(data).get("requestsSinceCheckpoint") != 0:
                    raise RuntimeError("request-before-corrected-proof")
                checkpoints += 1
            os.write(master, step["send"].encode())
            completed += 1
        while child.poll() is None:
            if time.monotonic() >= deadline:
                raise RuntimeError("exit-timeout")
            if select.select([master], [], [], 0.05)[0]:
                output += os.read(master, 4096)
                if len(output) > 30000:
                    raise RuntimeError("output-bound")
        while select.select([master], [], [], 0)[0]:
            output += os.read(master, 4096)
            if len(output) > 30000:
                raise RuntimeError("output-bound")
        text = output.decode(errors="replace")
        report = {"exitCode": child.returncode, "steps": completed, "checkpoints": checkpoints, "rawModeRestored": termios.tcgetattr(slave) == original,
                  "canaryLeak": any(value in text for value in config["canaries"]),
                  "expectedOutput": all(value in text for value in config["expectedOutput"]), "outputBytes": len(output)}
        report["passed"] = report["exitCode"] == config["expectedExit"] and report["rawModeRestored"] and not report["canaryLeak"] and report["expectedOutput"]
        print(json.dumps(report))
        return 0 if report["passed"] else 1
    except Exception:
        print(json.dumps({"passed": False, "stage": "owned-pty-refused", "steps": completed, "outputBytes": len(output)}))
        return 1
    finally:
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=5)
        os.close(master)
        os.close(slave)


if __name__ == "__main__":
    sys.exit(main())
