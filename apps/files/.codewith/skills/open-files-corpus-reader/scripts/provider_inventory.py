#!/usr/bin/env python3
"""Redacted provider/key inventory for open-files agent routing.

This script reports only environment variable names and redacted vault key
metadata. It never prints secret values.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any


PROVIDERS: dict[str, list[str]] = {
    "openai": ["OPENAI_API_KEY", "HASNAXYZ_OPENAI_LIVE_API_KEY", "HASNA_TAKUMI_LIVE_OPENAI_API_KEY"],
    "anthropic": ["ANTHROPIC_API_KEY", "HASNAXYZ_ANTHROPIC_LIVE_API_KEY", "HASNA_TAKUMI_LIVE_ANTHROPIC_API_KEY"],
    "openrouter": ["OPENROUTER_API_KEY", "HASNA_TAKUMI_LIVE_OPENROUTER_API_KEY"],
    "cerebras": ["CEREBRAS_API_KEY", "HASNA_CEREBRAS_LIVE_API_KEY", "HASNAXYZ_CEREBRAS_LIVE_API_KEY", "HASNA_TAKUMI_LIVE_CEREBRAS_API_KEY"],
    "xai": ["XAI_API_KEY", "GROK_API_KEY", "HASNA_TAKUMI_LIVE_XAI_API_KEY"],
    "elevenlabs": ["ELEVENLABS_API_KEY", "HASNAXYZ_ELEVENLABS_LIVE_API_KEY"],
    "groq": ["GROQ_API_KEY", "HASNA_TAKUMI_LIVE_GROQ_API_KEY"],
    "gemini": ["GEMINI_API_KEY", "GOOGLE_API_KEY", "HASNA_TAKUMI_LIVE_GEMINI_API_KEY"],
    "alibaba": ["ALIBABA_MODEL_API_KEY", "HASNA_TAKUMI_LIVE_ALIBABA_MODEL_API_KEY"],
}

SECRET_QUERIES = {
    "openai": "openai",
    "anthropic": "anthropic",
    "openrouter": "openrouter",
    "cerebras": "cerebras",
    "xai": "xai",
    "elevenlabs": "eleven",
    "groq": "groq",
    "gemini": "gemini",
    "alibaba": "alibaba_model",
}

EXPECTED_PREFIXES = {
    "openai": ["sk-"],
    "openrouter": ["sk-or-"],
    "xai": ["xai" + "-"],
    "anthropic": ["sk" + "-ant-"],
}

SECRET_LINE = re.compile(r"^(?P<key>\S+)(?: \((?P<label>[^)]*)\))? \[(?P<type>[^\]]+)\] = \*\*\*$")


@dataclass(frozen=True)
class SecretHit:
    key: str
    label: str | None
    type: str


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None


def search_secrets(query: str, timeout_seconds: int) -> list[SecretHit]:
    if not command_exists("secrets"):
        return []

    proc = subprocess.run(
        ["secrets", "search", query],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout_seconds,
    )
    hits: list[SecretHit] = []
    for line in proc.stdout.splitlines():
        match = SECRET_LINE.match(line.strip())
        if not match:
            continue
        hits.append(SecretHit(
            key=match.group("key"),
            label=match.group("label") or None,
            type=match.group("type"),
        ))
    return hits


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory provider keys without printing secret values.")
    parser.add_argument("--include-vault", action="store_true", help="Also search the local secrets vault by provider keyword.")
    parser.add_argument("--timeout-seconds", type=int, default=5, help="Per-provider secrets search timeout.")
    args = parser.parse_args()

    providers: dict[str, Any] = {}
    for provider, env_names in PROVIDERS.items():
        present_env = [name for name in env_names if os.environ.get(name)]
        expected_prefixes = EXPECTED_PREFIXES.get(provider, [])
        format_warnings = []
        if expected_prefixes:
            for name in present_env:
                value = os.environ.get(name, "")
                if not any(value.startswith(prefix) for prefix in expected_prefixes):
                    format_warnings.append({
                        "env": name,
                        "warning": f"present but does not match expected {provider} key prefix",
                    })
        entry: dict[str, Any] = {
            "env_key_names_checked": env_names,
            "env_key_names_present": present_env,
            "env_available": bool(present_env),
            "env_format_warnings": format_warnings,
        }
        if args.include_vault:
            hits = search_secrets(SECRET_QUERIES[provider], args.timeout_seconds)
            entry["vault_hits"] = [
                {"key": hit.key, "label": hit.label, "type": hit.type, "value": "***"}
                for hit in hits
            ]
            entry["vault_available"] = bool(hits)
        providers[provider] = entry

    output = {
        "redaction": "secret values are never printed; only env var names and redacted vault metadata",
        "tools": {
            "codewith": command_exists("codewith"),
            "codex": command_exists("codex"),
            "secrets": command_exists("secrets"),
            "todos": command_exists("todos"),
        },
        "providers": providers,
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
