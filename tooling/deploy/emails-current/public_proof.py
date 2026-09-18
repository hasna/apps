#!/usr/bin/env python3
"""Public, credential-free proof of the deployed Emails server contract."""
import argparse
import json
import re
import time
import urllib.request

BASE = "https://api.hasna.com/emails"


def require(ok, code):
    if not ok:
        raise ValueError(code)


def get(path, timeout=20):
    require(path.startswith("/") and not path.startswith("/v1/v1/"), "PUBLIC_PATH")
    request = urllib.request.Request(BASE + path, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        require(response.geturl() == BASE + path, "PUBLIC_REDIRECT")
        require(response.status == 200, "PUBLIC_HTTP")
        raw = response.read(2 * 1024 * 1024 + 1)
    require(len(raw) <= 2 * 1024 * 1024, "PUBLIC_RESPONSE_LIMIT")
    return json.loads(raw)


def prove(expected_version, attempts=60, interval=5):
    last = "PUBLIC_VERSION"
    for _ in range(attempts):
        try:
            version = get("/version")
            ready = get("/ready")
            if version.get("version") != expected_version or ready.get("version") != expected_version:
                last = "PUBLIC_VERSION"
                time.sleep(interval)
                continue
            require(version == {"status": "ok", "version": expected_version, "mode": "self_hosted", "name": "emails"}, "PUBLIC_VERSION_SHAPE")
            require(ready.get("status") == "ready" and ready.get("mode") == "self_hosted", "PUBLIC_READY")
            require(ready.get("pendingMigrations") == [] and ready.get("migrationIssues") == [], "PUBLIC_MIGRATIONS")
            document = get("/openapi.json")
            require(document.get("openapi") == "3.0.3" and document.get("info", {}).get("version") == expected_version, "PUBLIC_OPENAPI")
            paths = document.get("paths", {})
            require("/v1/providers/secrets/status" in paths and paths["/v1/providers/secrets/status"].get("get", {}).get("operationId") == "getProviderSecretStatus", "PUBLIC_PROVIDER_OPENAPI")
            require("/v1/providers/{id}/credentials" in paths and paths["/v1/providers/{id}/credentials"].get("put", {}).get("operationId") == "installProviderCredentials", "PUBLIC_PROVIDER_CREDENTIAL_OPENAPI")
            send = paths.get("/v1/messages/send", {}).get("post", {})
            schema = send.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema", {})
            properties = schema.get("properties", {})
            require(send.get("operationId") == "sendMessage" and "reply_to" in properties and "reply_to_message_id" in properties, "PUBLIC_REPLY_OPENAPI")
            require("parent participant" in properties["reply_to_message_id"].get("description", ""), "PUBLIC_REPLY_AUTHORITY")
            require(all(not key.startswith("/v1/v1/") for key in paths), "PUBLIC_DOUBLE_V1")
            return {
                "schema": "emails.public-live-proof.v1",
                "baseUrl": BASE,
                "version": expected_version,
                "openapi": document["openapi"],
                "pathCount": len(paths),
                "providerCredentialOperations": True,
                "replyAuthorityContract": True,
                "doubleV1Paths": 0,
                "pendingMigrations": 0,
            }
        except Exception as error:
            last = str(error) if type(error) is ValueError and re.fullmatch(r"[A-Z_]+", str(error)) else type(error).__name__
            time.sleep(interval)
    raise ValueError(last)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-version", required=True)
    parser.add_argument("--out")
    args = parser.parse_args()
    require(re.fullmatch(r"[0-9]+[.][0-9]+[.][0-9]+(?:[-+][0-9A-Za-z.-]+)?", args.expected_version), "EXPECTED_VERSION")
    proof = prove(args.expected_version)
    data = json.dumps(proof, sort_keys=True, separators=(",", ":")) + "\n"
    if args.out:
        with open(args.out, "x", encoding="utf-8") as handle:
            handle.write(data)
    print(data, end="")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit("Emails public proof refused: " + (str(error) if type(error) is ValueError else type(error).__name__))
