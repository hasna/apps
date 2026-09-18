#!/usr/bin/env python3
"""No-pull acceptance of preloaded immutable API/worker images on disposable fixtures.

This unsigned synthetic proof is never production activation authority. All subprocess
output is captured: neither synthetic credentials nor arbitrary image logs are printed.
"""
import argparse
import datetime
import json
import os
import re
from pathlib import Path
import secrets
import signal
import shutil
import subprocess
import tempfile
import time

from contract import COMMANDS, ENTRYPOINT, Refused, canonical, digest, has_repo_digest, inspected_container, inspected_image, loads, pair_input, require

HERE = Path(__file__).resolve().parent
FETCH = "const x=await Bun.stdin.json();try{const r=await fetch(x.url,{method:x.body===undefined?'GET':'POST',headers:x.headers||{},body:x.body===undefined?undefined:JSON.stringify(x.body),signal:AbortSignal.timeout(5000)});console.log(JSON.stringify({status:r.status,body:await r.json()}));}catch{console.log(JSON.stringify({status:0}));}"


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


class Docker:
    def __init__(self, directory, resource_id=None):
        self.directory = directory
        self.binary = shutil.which("docker")
        require(self.binary is not None, "DOCKER_UNAVAILABLE")
        # A fresh config plus an explicit Unix socket prevents inherited remote
        # contexts, credential helpers, registry logins, proxy and cloud settings.
        self.env = {"PATH": "/usr/bin:/bin:/usr/local/bin", "DOCKER_CONFIG": str(directory / "docker")}
        (directory / "docker").mkdir()
        require(resource_id is None or len(resource_id) == 20 and all(c in "0123456789abcdef" for c in resource_id), "RESOURCE_ID")
        self.prefix = resource_id or secrets.token_hex(10)
        self.network = "emails-pair-" + self.prefix
        self.containers = []
        self.network_created = False

    def call(self, *args, data=None, timeout=45, ok=True):
        try:
            result = subprocess.run([self.binary, "--host", "unix:///var/run/docker.sock", *args],
                                    input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    env=self.env, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise Refused("CONTAINER_COMMAND_UNCERTAIN") from None
        require(len(result.stdout) <= 8 * 1024 * 1024, "CONTAINER_OUTPUT_LIMIT")
        if ok:
            require(result.returncode == 0, "CONTAINER_COMMAND_FAILED")
        return result

    def json(self, *args, **kwargs):
        return loads(self.call(*args, **kwargs).stdout)

    def create_network(self):
        # Intent precedes the daemon call: a timed-out client is not proof that
        # the daemon did not create the network.
        self.network_created = True
        self.call("network", "create", "--internal", "--label", f"emails.pair={self.prefix}", self.network)
        row = self.json("network", "inspect", self.network)[0]
        require(row.get("Internal") is True and row.get("Driver") == "bridge", "FIXTURE_NETWORK_NOT_INTERNAL")

    def env_file(self, values):
        require(all("\n" not in k+str(v) and "\r" not in k+str(v) for k, v in values.items()), "ENVIRONMENT_FORMAT")
        target = self.directory / (secrets.token_hex(8)+".env")
        target.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
        target.chmod(0o600)
        return str(target)

    def start(self, role, image, command, env=None, mounts=(), aliases=(), postgres=False, network=None, admitted=None):
        name = self.network + "-" + role
        require(name not in self.containers, "CONTAINER_NAME_REUSE")
        self.containers.append(name)  # cleanup even if daemon created it then timed out
        args = ["create", "--pull=never", "--name", name, "--label", f"emails.pair={self.prefix}",
                "--network", network or self.network, "--read-only", "--cap-drop=ALL",
                "--security-opt=no-new-privileges", "--pids-limit=128", "--memory=768m", "--cpus=2",
                "--ipc=private", "--dns=127.0.0.1", "--no-healthcheck", "--tmpfs", "/tmp:rw,noexec,nosuid,size=67108864,mode=1777"]
        if postgres:
            args += ["--user", "70:70", "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=536870912,uid=70,gid=70,mode=0700",
                     "--tmpfs", "/var/run/postgresql:rw,nosuid,size=1048576,uid=70,gid=70"]
        else:
            args += ["--user", "1000:1000", "--entrypoint", ENTRYPOINT[0]]
        for alias in aliases:
            args += ["--network-alias", alias]
        if env:
            args += ["--env-file", self.env_file(env)]
        for source, target in mounts:
            require(source.is_file() and not source.is_symlink(), "FIXTURE_MOUNT")
            args += ["--mount", f"type=bind,src={source},dst={target},readonly"]
        self.call(*args, image, *command)
        if admitted:
            inspected_container(self.json("inspect", name), admitted, network or self.network, name)
        self.call("start", name)
        return name

    def exec_json(self, name, command, value, timeout=35):
        result = self.call("exec", "-i", name, ENTRYPOINT[0], *command, data=canonical(value), timeout=timeout, ok=False)
        try:
            value = loads(result.stdout)
        except Refused:
            raise Refused("IMAGE_OUTPUT_FORMAT") from None
        if result.returncode or isinstance(value, dict) and "error" in value:
            code = value.get("error") if isinstance(value, dict) else None
            raise Refused(code if isinstance(code, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,100}", code) else "IMAGE_TASK_FAILED")
        return value

    def stop(self, name):
        self.call("stop", "--time", "3", name, timeout=10)

    def cleanup(self):
        success = True
        deadline = time.monotonic() + 60
        for name in reversed(self.containers):
            if time.monotonic() >= deadline:
                return False
            result = self.call("inspect", name, ok=False, timeout=2)
            if result.returncode:
                success = False
                continue
            rows = loads(result.stdout)
            if len(rows) != 1 or (rows[0].get("Config", {}).get("Labels") or {}).get("emails.pair") != self.prefix:
                success = False
                continue
            success = self.call("rm", "--force", "--volumes", name, ok=False, timeout=3).returncode == 0 and success
        if self.network_created:
            names = self.call("network", "ls", "--format", "{{.Name}}", "--filter", "name="+self.network, timeout=2).stdout.decode().splitlines()
            if self.network in names:
                row = self.json("network", "inspect", self.network, timeout=2)[0]
                if (row.get("Labels") or {}).get("emails.pair") != self.prefix:
                    return False
                success = self.call("network", "rm", self.network, ok=False, timeout=3).returncode == 0 and success
        return success


def cleanup_owned_resources(docker, resource_id):
    """CI's independent ownership record survives a terminated inner runner."""
    require(len(resource_id) == 20 and all(c in "0123456789abcdef" for c in resource_id), "RESOURCE_ID")
    prefix = "emails-pair-"+resource_id
    names = docker.call("ps", "--all", "--filter", "label=emails.pair="+resource_id, "--format", "{{.Names}}", timeout=5).stdout.decode().splitlines()
    require(len(names) <= 20 and all(name.startswith(prefix+"-") for name in names), "CI_RESOURCE_OWNERSHIP")
    for name in names:
        row = docker.json("inspect", name, timeout=3)[0]
        require((row.get("Config", {}).get("Labels") or {}).get("emails.pair") == resource_id, "CI_RESOURCE_LABEL")
        docker.call("rm", "--force", "--volumes", name, timeout=5)
    networks = docker.call("network", "ls", "--filter", "label=emails.pair="+resource_id, "--format", "{{.Name}}", timeout=5).stdout.decode().splitlines()
    require(networks in ([], [prefix]), "CI_NETWORK_OWNERSHIP")
    if networks:
        row = docker.json("network", "inspect", prefix, timeout=3)[0]
        require((row.get("Labels") or {}).get("emails.pair") == resource_id, "CI_NETWORK_LABEL")
        docker.call("network", "rm", prefix, timeout=5)


def wait_for(probe, accept, code, timeout=35):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = probe()
        if accept(value):
            return value
        time.sleep(0.25)
    raise Refused(code)


class Acceptance:
    def __init__(self, docker, pair, report):
        self.docker, self.pair, self.report = docker, pair, report
        self.control_token = secrets.token_hex(32)
        self.signing_secret = secrets.token_hex(32)
        self.password = secrets.token_hex(32)
        self.runtime_password = secrets.token_hex(32)
        self.mounts = [(HERE / name, "/fixtures/"+name) for name in ("transports.ts", "image-task.ts", "image-imports.ts", "api-probe.ts", "probe-assertions.ts")]
        self.task_counter = 0

    def evidence(self, component, name, value):
        self.report[component][name] = {"status": "passed", "evidence_sha256": digest(canonical(value)), "observed": value}

    def task(self, value):
        return self.docker.exec_json(self.fixture, ["/fixtures/image-task.ts"], value)

    def fetch(self, name, url, body=None, control=False):
        value = {"url": url}
        if body is not None:
            value["body"] = body
        if control:
            value["headers"] = {"authorization": "Bearer "+self.control_token, "content-type": "application/json"}
        return self.docker.exec_json(name, ["-e", FETCH], value)

    def control(self, path, body=None):
        result = self.fetch(self.fixture, "http://127.0.0.1:9000/control/"+path, body, True)
        require(result.get("status") == 200, "FIXTURE_CONTROL_FAILED")
        return result["body"]

    def health(self, worker):
        return self.fetch(worker, "http://127.0.0.1:9487/health")

    def worker(self, suffix):
        name = self.docker.start("worker-"+suffix, self.pair["worker"]["image"], COMMANDS["worker"], self.runtime_env,
                                 mounts=[(self.docker.directory / "fixture.pem", "/fixtures/fixture.pem")], admitted=self.images["worker"])
        inspected_container(self.docker.json("inspect", name), self.images["worker"], self.docker.network, name)
        return name

    def enqueue(self, key, recipients=None):
        note = {"notificationType": "Received", "mail": {"messageId": key, "timestamp": timestamp()},
                "receipt": {"recipients": recipients or [self.tenants[0]["email"]],
                            "action": {"type": "S3", "bucketName": "pair-fixture", "objectKey": key}}}
        raw = "\r\n".join(["From: External <outside@external.test>", "To: forged@b.example.test", "Subject: Synthetic inbound",
                              f"Message-ID: <{key}@external.test>", "MIME-Version: 1.0", "Content-Type: text/plain", "", "Synthetic fixture only"])
        self.control("object", {"path": "/pair-fixture/"+key, "raw": raw})
        return self.control("enqueue", {"body": json.dumps(note)})["id"]

    def messages(self, key):
        return self.task({"action": "messages", "database_url": self.admin_url, "source_id": key})["rows"]

    def drained(self):
        return wait_for(lambda: self.control("state"), lambda s: not s["queue"], "QUEUE_NOT_DRAINED")

    def execute(self):
        d = self.docker
        self.images = {part: inspected_image(part, self.pair[part], d.json("image", "inspect", self.pair[part]["image"]),
                                           Path(self.pair[part]["manifest_path"]).read_bytes(), Path(self.pair[part]["config_path"]).read_bytes()) for part in COMMANDS}
        pg = d.json("image", "inspect", self.pair["postgres"]["image"])
        require(len(pg) == 1 and has_repo_digest(pg[0], self.pair["postgres"]["image"])
                and pg[0].get("Os") == "linux" and pg[0].get("Architecture") == "amd64"
                and "PG_MAJOR=16" in (pg[0].get("Config", {}).get("Env") or []), "POSTGRES_IMAGE_BINDING")
        self.report["images"] = self.images
        self.report["postgres"] = {"manifest_digest": self.pair["postgres"]["image"].split("@")[1], "config_id": pg[0]["Id"]}
        # Probe each actual image with no network before attaching any fixture.
        for component in COMMANDS:
            name = d.start("inventory-"+component, self.pair[component]["image"], ["-e", "setInterval(()=>{},1000)"], mounts=self.mounts, network="none")
            observed = d.exec_json(name, ["/fixtures/image-task.ts"], {"action": "inventory"})
            require(observed.get("migrations") == self.pair["migrations"] and observed.get("arch") == "x64"
                    and observed.get("version") == self.pair[component]["version"] and observed.get("bun_version") == "1.3.14", "IMAGE_RUNTIME_INVENTORY_DRIFT")
            self.images[component]["runtime_inventory_sha256"] = digest(canonical(observed))
            d.stop(name)
        d.create_network()
        cert, key = d.directory / "fixture.pem", d.directory / "fixture.key"
        result = subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                                 "-subj", "/CN=api.resend.com", "-addext", "subjectAltName=DNS:api.resend.com",
                                 "-keyout", str(key), "-out", str(cert)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
                                env={"PATH": "/usr/bin:/bin"}, check=False)
        require(result.returncode == 0, "FIXTURE_CERTIFICATE")
        key.chmod(0o644)  # ephemeral fixture only; readable by container UID 1000
        self.mounts += [(cert, "/fixtures/fixture.pem")]
        self.fixture = d.start("transport", self.pair["api"]["image"], ["/fixtures/transports.ts"],
                               {"PAIR_FIXTURE_CONTROL_TOKEN": self.control_token, "PAIR_FIXTURE_TLS_CERT": "/fixtures/fixture.pem", "PAIR_FIXTURE_TLS_KEY": "/fixtures/fixture.key"},
                               mounts=self.mounts+[(key, "/fixtures/fixture.key")], aliases=["api.resend.com"])
        fixture_row = d.json("inspect", self.fixture)[0]
        endpoint = "http://" + fixture_row["NetworkSettings"]["Networks"][d.network]["IPAddress"] + ":9000"
        require(endpoint.startswith("http://") and endpoint.count(":") == 2, "FIXTURE_IP")
        self.control("state")
        pg_name = d.start("postgres", self.pair["postgres"]["image"], ["postgres"],
                          {"POSTGRES_DB": "pair_fixture", "POSTGRES_PASSWORD": self.password}, aliases=["pair-db"], postgres=True)
        # The official entrypoint temporarily serves only a Unix socket during
        # initialization; API/worker clients require the final TCP listener.
        wait_for(lambda: d.call("exec", pg_name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "pair_fixture", ok=False).returncode,
                 lambda code: code == 0, "POSTGRES_NOT_READY")
        self.admin_url = f"postgresql://postgres:{self.password}@pair-db:5432/pair_fixture?sslmode=disable"
        runtime_url = f"postgresql://pair_runtime:{self.runtime_password}@pair-db:5432/pair_fixture?sslmode=disable"
        seeded = self.task({"action": "bootstrap", "database_url": self.admin_url, "runtime_password": self.runtime_password, "signing_secret": self.signing_secret})
        require(seeded.get("migrations") == self.pair["migrations"], "MIGRATED_INVENTORY_DRIFT")
        self.tenants = seeded["tenants"]
        self.report["migrations"] = self.pair["migrations"]
        self.evidence("api", "database_rls", self.task({"action": "rls", "database_url": runtime_url, "tenant_id": self.tenants[0]["id"]}))
        self.runtime_env = {"EMAILS_DATABASE_URL": runtime_url, "PGSSLMODE": "disable", "EMAILS_API_SIGNING_KEY": self.signing_secret,
                            "EMAILS_AUTH_ALLOWED_EMAIL_DOMAINS": "a.example.test,b.example.test", "EMAILS_AUTH_FROM": "auth@a.example.test",
                            "AWS_REGION": "us-east-1", "EMAILS_AWS_REGION": "us-east-1", "AWS_ACCESS_KEY_ID": "synthetic-access",
                            "AWS_SECRET_ACCESS_KEY": secrets.token_hex(32), "AWS_EC2_METADATA_DISABLED": "true", "AWS_MAX_ATTEMPTS": "1",
                            "AWS_ENDPOINT_URL_SQS": endpoint, "AWS_ENDPOINT_URL_S3": endpoint, "AWS_ENDPOINT_URL_SESV2": endpoint,
                            "EMAILS_INGEST_QUEUE_URL": endpoint+"/queue", "EMAILS_INGEST_S3_BUCKET": "pair-fixture",
                            "EMAILS_WORKER_HEALTH_PORT": "9487", "EMAILS_WORKER_PROGRESS_STALE_MS": "1500", "EMAILS_INGEST_QUEUE_AGE_POLL_SECONDS": "1",
                            "EMAILS_SES_ACCESS_KEY_ID": "synthetic-access", "EMAILS_SES_SECRET_ACCESS_KEY": secrets.token_hex(32),
                            "RESEND_API_KEY": "re_"+secrets.token_hex(24), "NODE_EXTRA_CA_CERTS": "/fixtures/fixture.pem"}
        # Missing, altered and unknown ledger entries must refuse before any SDK request.
        for mode in ("missing", "checksum", "unknown"):
            self.task({"action": "ledger", "database_url": self.admin_url, "mode": mode})
            before = len(self.control("state")["events"])
            worker = self.worker(mode)
            row = wait_for(lambda: d.json("inspect", worker)[0], lambda r: r["State"]["Status"] == "exited", "WORKER_SCHEMA_FENCE_MISSING", timeout=12)
            require(row["State"]["ExitCode"] != 0 and len(self.control("state")["events"]) == before, "WORKER_SCHEMA_FENCE_CONSUMED")
            self.task({"action": "ledger", "database_url": self.admin_url, "mode": "restore"})
        self.evidence("worker", "schema_fence", {"rejected_before_transport": ["missing", "checksum", "unknown"]})
        for provider in ("ses", "resend"):
            api = d.start("api-"+provider, self.pair["api"]["image"], COMMANDS["api"], {**self.runtime_env, "EMAILS_SEND_PROVIDER": provider},
                          mounts=[(cert, "/fixtures/fixture.pem")], aliases=["pair-api"], admitted=self.images["api"])
            inspected_container(d.json("inspect", api), self.images["api"], d.network, api)
            wait_for(lambda: self.fetch(self.fixture, "http://pair-api:8080/ready"), lambda r: r.get("status") == 200, "API_NOT_READY")
            result = d.exec_json(self.fixture, ["/fixtures/api-probe.ts"], {"tenants": self.tenants, "provider": provider,
                                 "control_token": self.control_token, "version": self.pair["api"]["version"]}, timeout=45)
            self.evidence("api", provider, result)
            d.stop(api)
            # Remove the stopped DNS alias before the next provider process.
            d.call("network", "disconnect", d.network, api)
        worker = self.worker("valid")
        initial = wait_for(lambda: self.health(worker), lambda r: r.get("status") == 200 and r["body"]["progress"]["cycles"] > 0, "WORKER_NOT_READY")
        first_id = self.enqueue("route-one")
        self.drained()
        rows = self.messages("route-one")
        require(len(rows) == 1 and rows[0]["tenant_id"] == self.tenants[0]["id"] and rows[0]["to_addrs"] == [self.tenants[0]["email"]], "WORKER_TENANT_ROUTING")
        self.evidence("worker", "tenant_routing", {"rows": len(rows), "envelope_over_mime": True})
        self.enqueue("route-one")
        self.drained()
        require(len(self.messages("route-one")) == 1, "WORKER_DEDUPLICATION")
        self.evidence("worker", "deduplication", {"rows_after_redelivery": 1})
        self.control("mode", {"deleteFailures": 1})
        retry_id = self.enqueue("ack-retry")
        state = self.drained()
        events = [e for e in state["events"] if e.get("id") == retry_id]
        require(sum(e["operation"] == "sqs.receive" for e in events) >= 2 and any(e["operation"] == "sqs.delete" and e["status"] == 500 for e in events)
                and any(e["operation"] == "sqs.delete" and e["status"] == 200 for e in events) and len(self.messages("ack-retry")) == 1, "WORKER_ACK_RETRY")
        # Object read failure must leave the queue receipt unacknowledged until recovery.
        self.control("mode", {"object": "fail"})
        fail_id = self.enqueue("object-retry")
        wait_for(lambda: self.control("state"), lambda s: any(e["operation"] == "s3.get" and e["status"] == 500 and e.get("id") == "/pair-fixture/object-retry" for e in s["events"]), "WORKER_OBJECT_FAILURE")
        require(any(q["id"] == fail_id for q in self.control("state")["queue"]) and not self.messages("object-retry"), "WORKER_PREMATURE_ACK")
        self.control("mode", {"object": "normal"})
        self.drained()
        require(len(self.messages("object-retry")) == 1, "WORKER_OBJECT_RETRY")
        self.evidence("worker", "ack_retry", {"failed_ack_redelivered": True, "failed_object_retained": True})
        current = self.health(worker)
        require(current["status"] == 200 and current["body"]["progress"]["cycles"] > initial["body"]["progress"]["cycles"], "WORKER_PROGRESS")
        self.evidence("worker", "progress", current["body"])
        self.control("mode", {"object": "stall"})
        self.enqueue("stalled")
        stalled = wait_for(lambda: self.health(worker), lambda r: r.get("status") == 503 and r["body"].get("status") == "stale_with_work"
                           and r["body"].get("queue", {}).get("visible", 0) > 0, "WORKER_STALL_NOT_DETECTED", timeout=20)
        require(stalled["body"]["queue"]["oldest_age_seconds"] is None, "WORKER_INVENTED_QUEUE_AGE")
        self.evidence("worker", "queue_visible", stalled["body"]["queue"])
        self.control("mode", {"object": "normal"})
        self.drained()
        recovered = wait_for(lambda: self.health(worker), lambda r: r.get("status") == 200 and r["body"]["progress"]["cycles"] > current["body"]["progress"]["cycles"], "WORKER_STALL_NOT_RECOVERED")
        require(len(self.messages("stalled")) == 1, "WORKER_STALLED_MESSAGE_LOST")
        self.evidence("worker", "stalled_recovery", {"stalled": stalled["body"], "recovered": recovered["body"]})
        d.stop(worker)
        state = self.control("state")
        require(not any(e["operation"].startswith(("unexpected.", "invalid.")) for e in state["events"]), "UNEXPECTED_FIXTURE_REQUEST")
        self.report["fixture"] = {"network_internal": True, "provider_transport": "synthetic-wire-https-and-aws-sdk",
                                  "external_provider_sends": 0, "production_queue_reads": 0, "events_sha256": digest(canonical(state["events"])),
                                  "event_count": len(state["events"]), "tls_ca_sha256": digest(cert.read_bytes())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resource-id", help="Optional CI-owned 20-hex cleanup identity")
    args = parser.parse_args()
    require(not args.output.exists(), "OUTPUT_ALREADY_EXISTS")
    report = {"schema": "emails.isolated-pair-acceptance.v1", "deployment_authorized": False, "status": "failed",
              "production_configuration_verified": False, "started_at": timestamp(), "api": {}, "worker": {}}
    report["runner_sha256"] = digest(canonical({p.name: digest(p.read_bytes()) for p in sorted(HERE.iterdir()) if p.suffix in (".py", ".ts")}))
    docker = None
    handlers = {}
    try:
        raw = args.pair.read_bytes()
        pair = pair_input(raw)
        report["input_sha256"] = digest(raw)
        with tempfile.TemporaryDirectory(prefix="emails-pair-") as temporary:
            try:
                docker = Docker(Path(temporary), args.resource_id)
                report["resource_id"] = docker.prefix
                def interrupted(_signal, _frame):
                    raise Refused("RUNNER_INTERRUPTED")
                for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGALRM):
                    handlers[sig] = signal.getsignal(sig)
                    signal.signal(sig, interrupted)
                signal.alarm(480)
                Acceptance(docker, pair, report).execute()
                report["status"] = "passed"
            finally:
                if docker:
                    signal.alarm(0)
                    signal.signal(signal.SIGTERM, signal.SIG_IGN)
                    signal.signal(signal.SIGINT, signal.SIG_IGN)
                    try:
                        report["cleanup_complete"] = docker.cleanup()
                    except (Refused, OSError):
                        report["cleanup_complete"] = False
                    if not report["cleanup_complete"]:
                        report["status"] = "failed"
                        report["failure_code"] = "FIXTURE_CLEANUP_INCOMPLETE"
    except (Refused, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        report["failure_code"] = str(error) if isinstance(error, Refused) else "RUNNER_FAILED"
    finally:
        for sig, handler in handlers.items():
            signal.signal(sig, handler)
    report["completed_at"] = timestamp()
    with args.output.open("xb") as stream:
        stream.write(canonical(report)+b"\n")
    print(json.dumps({"status": report["status"], "proof_sha256": digest(args.output.read_bytes()),
                      **({"failure_code": report["failure_code"]} if "failure_code" in report else {})}))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
