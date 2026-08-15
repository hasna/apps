#!/usr/bin/env python3
"""Offline tests for adversarial reviewer result verification."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "verify_adversarial_review_results.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("verify_adversarial_review_results", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def write_source_artifacts(root: Path) -> dict[str, Path]:
    packet = root / "adversarial-review-packet.json"
    schema = root / "reviewer-final.schema.json"
    prompt_a = root / "reviewer-a-prompt.md"
    prompt_b = root / "reviewer-b-prompt.md"
    packet.write_text(json.dumps({"kind": "open_files_adversarial_review_packet"}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    schema.write_text(json.dumps({"title": "OpenFilesAdversarialReview"}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    prompt_a.write_text("reviewer a aggregate prompt\n", encoding="utf-8")
    prompt_b.write_text("reviewer b aggregate prompt\n", encoding="utf-8")
    return {
        "packet": packet,
        "schema": schema,
        "reviewer_a_prompt": prompt_a,
        "reviewer_b_prompt": prompt_b,
    }


def input_attestation(reviewer: str, sources: dict[str, Path]) -> dict[str, str]:
    prompt_key = "reviewer_a_prompt" if reviewer == "reviewer_a" else "reviewer_b_prompt"
    return {
        "reviewer": reviewer,
        "packet_sha256": hashlib.sha256(sources["packet"].read_bytes()).hexdigest(),
        "schema_sha256": hashlib.sha256(sources["schema"].read_bytes()).hexdigest(),
        "reviewer_prompt_sha256": hashlib.sha256(sources[prompt_key].read_bytes()).hexdigest(),
    }


def review(reviewer: str, sources: dict[str, Path], verdict: str = "fail") -> dict:
    return {
        "reviewer": reviewer,
        "verdict": verdict,
        "approved_to_scale": False,
        "blockers": ["approval required"],
        "risks": [
            {
                "severity": "blocker",
                "code": "APPROVAL-GATE",
                "finding": "Scale is not approved.",
                "evidence": "Aggregate approval gate is pending.",
                "recommendation": "Do not scale until approved.",
            }
        ],
        "required_next_actions": ["record approval"],
        "privacy_confirmation": {
            "reviewed_only_packet_files": True,
            "no_private_values_in_response": True,
            "no_file_content_requested": True,
        },
        "input_attestation": input_attestation(reviewer, sources),
        "summary": "Aggregate review only.",
    }


def write(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


class VerifyAdversarialReviewResultsTests(unittest.TestCase):
    def test_valid_reviewer_failures_are_reviewed_with_blockers(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sources = write_source_artifacts(root)
            a = root / "a.json"
            b = root / "b.json"
            write(a, review("reviewer_a", sources))
            write(b, review("reviewer_b", sources))

            result = verifier.build_summary(
                a,
                b,
                packet=sources["packet"],
                schema=sources["schema"],
                reviewer_a_prompt=sources["reviewer_a_prompt"],
                reviewer_b_prompt=sources["reviewer_b_prompt"],
            )

        self.assertEqual(result["status"], "reviewed_with_blockers")
        self.assertEqual(result["totals"]["reviewers_present"], 2)
        self.assertEqual(result["totals"]["blockers"], 2)
        self.assertTrue(result["freshness"]["all_input_attestations_match"])
        self.assertEqual(result["errors"], [])
        self.assertNotIn("approval required", json.dumps(result))

    def test_stale_input_attestation_fails(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sources = write_source_artifacts(root)
            a = root / "a.json"
            b = root / "b.json"
            stale = review("reviewer_a", sources)
            stale["input_attestation"]["packet_sha256"] = "0" * 64
            write(a, stale)
            write(b, review("reviewer_b", sources))

            result = verifier.build_summary(
                a,
                b,
                packet=sources["packet"],
                schema=sources["schema"],
                reviewer_a_prompt=sources["reviewer_a_prompt"],
                reviewer_b_prompt=sources["reviewer_b_prompt"],
            )

        self.assertEqual(result["status"], "failed")
        self.assertIn("reviewer_a:input_attestation_mismatch:packet_sha256", result["errors"])
        self.assertFalse(result["freshness"]["all_input_attestations_match"])

    def test_sensitive_marker_fails_without_echoing_private_value(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sources = write_source_artifacts(root)
            a = root / "a.json"
            b = root / "b.json"
            bad = review("reviewer_a", sources)
            bad["summary"] = "leaked open-files://f_secret123"
            write(a, bad)
            write(b, review("reviewer_b", sources))

            result = verifier.build_summary(
                a,
                b,
                packet=sources["packet"],
                schema=sources["schema"],
                reviewer_a_prompt=sources["reviewer_a_prompt"],
                reviewer_b_prompt=sources["reviewer_b_prompt"],
            )

        self.assertEqual(result["status"], "failed")
        self.assertIn("reviewer_a:sensitive_marker_hits", result["errors"])
        self.assertNotIn("f_secret123", json.dumps(result))

    def test_cli_writes_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sources = write_source_artifacts(root)
            a = root / "a.json"
            b = root / "b.json"
            output = root / "summary.json"
            write(a, review("reviewer_a", sources))
            write(b, review("reviewer_b", sources))

            proc = run_script(
                "--reviewer-a", str(a),
                "--reviewer-b", str(b),
                "--packet", str(sources["packet"]),
                "--schema", str(sources["schema"]),
                "--reviewer-a-prompt", str(sources["reviewer_a_prompt"]),
                "--reviewer-b-prompt", str(sources["reviewer_b_prompt"]),
                "--output", str(output),
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            generated = proc.stdout + output.read_text(encoding="utf-8")
            self.assertIn("reviewed_with_blockers", generated)
            self.assertNotIn("approval required", generated)


if __name__ == "__main__":
    unittest.main()
