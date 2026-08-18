#!/usr/bin/env python3
"""Offline tests for campaign result collection."""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLANNER = ROOT / "scripts" / "plan_llm_review_campaign.py"
COLLECTOR = ROOT / "scripts" / "collect_llm_review_campaign_results.py"


def write_manifest(path: Path, rows: int) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for index in range(rows):
            handle.write(json.dumps({
                "file_id": f"f_private_{index}",
                "owner": "finance",
                "extractor_lane": "text",
                "expected_ext": "txt",
                "private_metadata": {"file_name": f"private-{index}.txt"},
                "source_ref": f"s3://private/object-{index}",
            }, sort_keys=True) + "\n")


def source_identity_sha256(file_id: str) -> str:
    digest = hashlib.sha256()
    digest.update(file_id.encode("utf-8"))
    digest.update(b"\n")
    return digest.hexdigest()


def run_script(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(script), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def plan_campaign(root: Path, rows: int = 2) -> Path:
    manifest = root / "manifest.jsonl"
    output = root / "campaign"
    write_manifest(manifest, rows)
    proc = run_script(
        PLANNER,
        "--manifest",
        str(manifest),
        "--output-dir",
        str(output),
        "--jobs-per-shard",
        "1",
        "--campaign-id",
        "collector-test",
    )
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return output / "campaign-plan.json"


def write_completed_outputs(
    plan: Path,
    omit_last: bool = False,
    bad_basename: bool = False,
    omit_last_attestation: bool = False,
    duplicate_first_attestation: bool = False,
    extra_first_attestation: bool = False,
    bad_first_attestation_hash: bool = False,
    bad_provider_payload_policy: bool = False,
) -> None:
    data = json.loads(plan.read_text(encoding="utf-8"))
    for index, entry in enumerate(data["shard_entries"], start=1):
        shard_manifest = Path(entry["manifest"])
        rows = [json.loads(line) for line in shard_manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
        file_id = rows[0]["file_id"]
        output_dir = Path(entry["output_dir"])
        output_dir.mkdir(parents=True, exist_ok=True)
        proposals = output_dir / "chunk-0001.proposals.jsonl"
        errors = output_dir / "chunk-0001.errors.jsonl"
        runtime_attestations = output_dir / "chunk-0001.runtime-attestations.jsonl"
        if omit_last and index == len(data["shard_entries"]):
            proposals.write_text("", encoding="utf-8")
            runtime_attestations.write_text("", encoding="utf-8")
        else:
            canonical_name = f"safe-document-{index}.txt"
            target_path = f"finance/{canonical_name}"
            if bad_basename and index == 1:
                target_path = "finance/mismatched-name.txt"
            proposals.write_text(json.dumps({
                "file_id": file_id,
                "canonical_name": canonical_name,
                "target_path": target_path,
                "document_kind": "document",
                "confidence": "low",
                "requires_review": True,
                "reason": "Derived from bounded artifact status.",
            }, sort_keys=True) + "\n", encoding="utf-8")
            attestation_rows = [{
                "kind": "open_files_llm_job_runtime_attestation",
                "version": 1,
                "chunk_ref": "chunk-0001",
                "job_ref": "job-000001",
                "status": "ok",
                "execution_mode": "direct-api",
                "source_identity_sha256": "0" * 64 if bad_first_attestation_hash and index == 1 else source_identity_sha256(file_id),
                "source_identity_disclosure": "hash-only",
                "row_safety_counts": {
                    "source_reference_fields": 0,
                    "private_payload_fields": 0,
                    "metadata_target_fields": 0,
                    "sensitive_value_marker_hits": 0,
                },
                "provider_payload_policy": {
                    "status": "requires_review" if bad_provider_payload_policy and index == 1 else "ok",
                    "execution_mode": "direct-api",
                    "proof_source": "direct-api-audit",
                    "payload_class": "sanitized-bounded-review-jobs",
                    "real_file_ids_sent": False,
                    "raw_file_bytes_sent": False,
                    "raw_extracts_sent": False,
                    "object_keys_sent": False,
                    "source_refs_sent": False,
                    "filenames_sent": False,
                    "secret_values_sent": False,
                    "provider_data_collection_denied": True,
                    "allowed_host_policy_matched": not (bad_provider_payload_policy and index == 1),
                },
                "canonical_bytes_policy": {
                    "canonical_s3_keys_immutable": True,
                    "source_bytes_read_only": True,
                    "s3_mutation_attempted_by_runner": False,
                },
                "write_policy": {
                    "metadata_only": True,
                    "metadata_apply_attempted": False,
                    "search_index_write_attempted": False,
                    "source_byte_write_attempted": False,
                },
                "validation": {
                    "worker_output_validation_ok": True,
                    "requires_human_review_before_apply": True,
                },
            }]
            if duplicate_first_attestation and index == 1:
                attestation_rows.append(dict(attestation_rows[0]))
            if extra_first_attestation and index == 1:
                extra = dict(attestation_rows[0])
                extra["job_ref"] = "job-999999"
                extra["source_identity_sha256"] = source_identity_sha256("extra-private-id")
                attestation_rows.append(extra)
            if omit_last_attestation and index == len(data["shard_entries"]):
                attestation_rows = []
            runtime_attestations.write_text(
                "".join(json.dumps(row, sort_keys=True) + "\n" for row in attestation_rows),
                encoding="utf-8",
            )
        errors.write_text("", encoding="utf-8")
        state = {
            "version": 1,
            "status": "completed",
            "jobs_scheduled": 1,
            "chunks_total": 1,
            "completed_chunks": [1],
            "chunks": {
                "1": {
                    "status": "completed",
                    "jobs": 1,
                    "proposal_rows": 0 if omit_last and index == len(data["shard_entries"]) else 1,
                    "error_rows": 0,
                    "outputs": {
                        "manifest": str(shard_manifest),
                        "proposals": str(proposals),
                        "errors": str(errors),
                        "final_output": str(output_dir / "chunk-0001.final.json"),
                        "runtime_attestations": str(runtime_attestations),
                    },
                }
            },
            "redaction": "state omits private rows",
        }
        Path(entry["state_file"]).write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


class CampaignResultCollectorTests(unittest.TestCase):
    def test_not_started_plan_is_aggregate_only_and_non_failing_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            proc = run_script(COLLECTOR, "--plan", str(plan), "--skip-db-check")
            strict_proc = run_script(COLLECTOR, "--plan", str(plan), "--skip-db-check", "--require-complete")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "not_started")
        self.assertEqual(summary["shard_states"]["missing"], 2)
        self.assertEqual(summary["runtime_attestation_gate"]["status"], "pending")
        self.assertEqual(summary["runtime_attestation_gate"]["planned_outputs"], 2)
        self.assertEqual(summary["runtime_attestation_gate"]["expected_outputs"], 0)
        self.assertNotEqual(strict_proc.returncode, 0)
        self.assertNotIn("f_private_", proc.stdout)
        self.assertNotIn("s3://private", proc.stdout)

    def test_complete_campaign_collects_and_validates_proposals(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            write_completed_outputs(plan)
            proc = run_script(COLLECTOR, "--plan", str(plan), "--skip-db-check", "--require-complete")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "complete")
        self.assertEqual(summary["proposal_rows"], 2)
        self.assertEqual(summary["coverage"]["missing"], 0)
        self.assertEqual(summary["proposal_validation"]["status"], "valid")
        self.assertEqual(summary["rename_correctness_gate"]["status"], "ok")
        self.assertTrue(summary["rename_correctness_gate"]["coverage_complete"])
        self.assertEqual(summary["rename_correctness_gate"]["basename_match_rows"], 2)
        self.assertEqual(summary["rename_correctness_gate"]["extension_preserved_rows"], 2)
        self.assertFalse(summary["rename_correctness_gate"]["metadata_apply_ready"])
        self.assertTrue(summary["rename_correctness_gate"]["runtime_attestation_complete"])
        self.assertEqual(summary["runtime_attestation_gate"]["status"], "ok")
        self.assertEqual(summary["runtime_attestation_gate"]["expected_outputs"], 2)
        self.assertEqual(summary["runtime_attestation_gate"]["source_identity_matched_rows"], 2)
        self.assertEqual(summary["runtime_attestation_gate"]["duplicate_attestation_refs"], 0)
        self.assertEqual(summary["runtime_attestation_gate"]["extra_attestations"], 0)
        self.assertEqual(summary["runtime_attestation_gate"]["provider_payload_policy_attested_rows"], 2)
        self.assertEqual(summary["runtime_attestation_gate"]["provider_payload_policy_violation_rows"], 0)
        self.assertEqual(summary["runtime_attestation_gate"]["immutable_bytes_attested_rows"], 2)
        self.assertEqual(summary["runtime_attestation_gate"]["metadata_only_attested_rows"], 2)
        self.assertEqual(summary["runtime_attestation_gate"]["metadata_apply_attempted_rows"], 0)
        self.assertEqual(summary["runtime_attestation_gate"]["worker_output_validation_ok_rows"], 2)
        self.assertEqual(summary["runtime_attestation_gate"]["requires_review_before_apply_rows"], 2)
        self.assertEqual(summary["scale_readiness_attestation"]["status"], "full_run_verified")
        self.assertTrue(summary["scale_readiness_attestation"]["canary"]["verified"])
        self.assertTrue(summary["scale_readiness_attestation"]["full_run"]["verified"])
        self.assertNotIn("f_private_", proc.stdout)
        self.assertNotIn("s3://private", proc.stdout)

    def test_completed_campaign_with_missing_output_is_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            write_completed_outputs(plan, omit_last=True)
            proc = run_script(COLLECTOR, "--plan", str(plan), "--skip-db-check", "--require-complete")

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["coverage"]["missing"], 1)
        self.assertEqual(summary["rename_correctness_gate"]["status"], "blocked")
        self.assertFalse(summary["rename_correctness_gate"]["coverage_complete"])
        self.assertEqual(summary["runtime_attestation_gate"]["status"], "blocked")
        self.assertEqual(summary["runtime_attestation_gate"]["missing_attestations"], 1)
        self.assertEqual(summary["scale_readiness_attestation"]["status"], "blocked")
        self.assertFalse(summary["scale_readiness_attestation"]["full_run"]["verified"])
        self.assertNotIn("f_private_", proc.stdout)

    def test_completed_campaign_without_attestation_blocks_runtime_and_rename_gates(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            write_completed_outputs(plan, omit_last_attestation=True)
            proc = run_script(COLLECTOR, "--plan", str(plan), "--skip-db-check", "--require-complete")

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["coverage"]["missing"], 0)
        self.assertEqual(summary["runtime_attestation_gate"]["status"], "blocked")
        self.assertEqual(summary["runtime_attestation_gate"]["missing_attestations"], 1)
        self.assertEqual(summary["rename_correctness_gate"]["status"], "blocked")
        self.assertFalse(summary["rename_correctness_gate"]["runtime_attestation_complete"])
        self.assertIn("runtime attestation gate not ok", summary["rename_correctness_gate"]["metadata_apply_blocker"])
        self.assertEqual(summary["scale_readiness_attestation"]["status"], "blocked")
        self.assertFalse(summary["scale_readiness_attestation"]["canary"]["verified"])
        self.assertNotIn("f_private_", proc.stdout)

    def test_completed_campaign_with_duplicate_attestation_ref_is_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            write_completed_outputs(plan, duplicate_first_attestation=True)
            proc = run_script(COLLECTOR, "--plan", str(plan), "--skip-db-check", "--require-complete")

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["runtime_attestation_gate"]["status"], "blocked")
        self.assertEqual(summary["runtime_attestation_gate"]["duplicate_attestation_refs"], 1)
        self.assertEqual(summary["rename_correctness_gate"]["runtime_attestation_gate_status"], "blocked")
        self.assertEqual(summary["scale_readiness_attestation"]["status"], "blocked")
        self.assertNotIn("f_private_", proc.stdout)

    def test_completed_campaign_with_extra_attestation_ref_is_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            write_completed_outputs(plan, extra_first_attestation=True)
            proc = run_script(COLLECTOR, "--plan", str(plan), "--skip-db-check", "--require-complete")

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["runtime_attestation_gate"]["status"], "blocked")
        self.assertEqual(summary["runtime_attestation_gate"]["extra_attestations"], 1)
        self.assertEqual(summary["scale_readiness_attestation"]["status"], "blocked")
        self.assertNotIn("f_private_", proc.stdout)

    def test_completed_campaign_with_bad_attestation_hash_is_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            write_completed_outputs(plan, bad_first_attestation_hash=True)
            proc = run_script(COLLECTOR, "--plan", str(plan), "--skip-db-check", "--require-complete")

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["runtime_attestation_gate"]["status"], "blocked")
        self.assertEqual(summary["runtime_attestation_gate"]["source_identity_mismatches"], 1)
        self.assertEqual(summary["scale_readiness_attestation"]["status"], "blocked")
        self.assertNotIn("f_private_", proc.stdout)

    def test_completed_campaign_with_bad_provider_payload_policy_is_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            write_completed_outputs(plan, bad_provider_payload_policy=True)
            proc = run_script(COLLECTOR, "--plan", str(plan), "--skip-db-check", "--require-complete")

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["runtime_attestation_gate"]["status"], "blocked")
        self.assertEqual(summary["runtime_attestation_gate"]["provider_payload_policy_attested_rows"], 1)
        self.assertEqual(summary["runtime_attestation_gate"]["provider_payload_policy_violation_rows"], 1)
        self.assertEqual(summary["rename_correctness_gate"]["runtime_attestation_gate_status"], "blocked")
        self.assertEqual(summary["scale_readiness_attestation"]["status"], "blocked")
        self.assertNotIn("f_private_", proc.stdout)

    def test_completed_campaign_with_bad_rename_gate_is_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            write_completed_outputs(plan, bad_basename=True)
            proc = run_script(COLLECTOR, "--plan", str(plan), "--skip-db-check", "--require-complete")

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["rename_correctness_gate"]["status"], "blocked")
        self.assertEqual(summary["rename_correctness_gate"]["basename_match_rows"], 1)
        self.assertEqual(summary["runtime_attestation_gate"]["status"], "ok")
        self.assertEqual(summary["scale_readiness_attestation"]["status"], "blocked")
        self.assertNotIn("f_private_", proc.stdout)


if __name__ == "__main__":
    unittest.main()
