#!/usr/bin/env python3
"""Offline tests for approval-gated derived search-index population runs."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_plan_search_index_population import SCRIPT as PLANNER
from test_plan_search_index_population import setup_db


VALIDATOR = Path(__file__).resolve().parents[1] / "scripts" / "validate_search_index_population_plan.py"
RUNNER = Path(__file__).resolve().parents[1] / "scripts" / "run_search_index_population_plan.py"


def run_script(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(script), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def plan(root: Path, approved: bool) -> Path:
    db = root / "files.db"
    output = root / "plan"
    setup_db(db)
    args = [
        "--db",
        str(db),
        "--output-dir",
        str(output),
        "--jobs-per-shard",
        "3",
    ]
    if approved:
        args.extend(["--approved", "--approval-note", "approved-offline-test"])
    proc = run_script(PLANNER, *args)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return output / "search-index-population-plan.json"


def write_fake_extractor(path: Path) -> None:
    path.write_text(
        """#!/usr/bin/env python3
import json
import pathlib
import sys
file_id = sys.argv[1]
artifact_dir = pathlib.Path(sys.argv[sys.argv.index("--artifact-dir") + 1])
review = artifact_dir / "private-review.json"
review.write_text(json.dumps({
    "file_id": file_id,
    "lane": "readable_now_text",
    "status": "ready",
    "extractor": "fake-extractor",
    "artifact_ready": True,
    "content_ready": True,
    "review": {
        "redacted_excerpt": "warehouse renewal summary",
        "text_metrics": {"words": 3}
    }
}), encoding="utf-8")
(artifact_dir / "downloads").mkdir(parents=True, exist_ok=True)
(artifact_dir / "downloads" / "private-download.bin").write_bytes(b"private")
print(json.dumps({
    "status": "ready",
    "file_id": file_id,
    "artifact_ready": True,
    "content_ready": True,
    "usable": True,
    "extractor": "fake-extractor",
    "review_artifact": str(review)
}))
""",
        encoding="utf-8",
    )
    path.chmod(0o755)


def write_fake_files(path: Path) -> None:
    path.write_text(
        """#!/usr/bin/env python3
import json
import os
import pathlib
import sys
args = sys.argv[1:]
state_path = pathlib.Path(__file__).with_suffix(".state.json")
if args and args[0] == "search":
    query = args[1]
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    text = state.get("searchable_text", "")
    if all(term.lower() in text.lower() for term in query.split()):
        print(json.dumps([{
            "id": state.get("file_id"),
            "search_match_sources": ["content"],
            "search_document_kinds": [state.get("kind", "semantic_metadata")]
        }]))
    else:
        print(json.dumps([]))
    raise SystemExit(0)
text_path = pathlib.Path(args[args.index("--text-file") + 1])
kind = args[args.index("--kind") + 1]
file_id = args[2]
searchable_text = text_path.read_text(encoding="utf-8")
state_path.write_text(json.dumps({
    "file_id": file_id,
    "kind": kind,
    "searchable_text": searchable_text
}), encoding="utf-8")
print(json.dumps({
    "id": "fsd_private",
    "file_id": file_id,
    "kind": kind,
    "status": "ready",
    "db_path": os.environ.get("HASNA_FILES_DB_PATH"),
    "searchable_chars": len(searchable_text),
    "searchable_text": searchable_text
}))
""",
        encoding="utf-8",
    )
    path.chmod(0o755)


def write_global_gate(path: Path) -> None:
    path.write_text(json.dumps({
        "kind": "open_files_extraction_lane_readiness_gate",
        "status": "pending_completion",
        "gate": {
            "status": "pending_completion",
            "requires_operator_approval_before_scale": True,
            "full_extraction_complete": False,
        },
        "totals": {
            "hard_blocker_lanes": 0,
            "pending_lanes": 8,
        },
    }), encoding="utf-8")


class SearchIndexPopulationRunnerTests(unittest.TestCase):
    def test_validator_accepts_clean_plan_and_redacts_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            proc = run_script(VALIDATOR, "--plan", str(plan_path))

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "ok")
        self.assertEqual(summary["jobs_from_shards"], 2)
        self.assertEqual(summary["duplicate_private_file_ids"], 0)
        self.assertNotIn("f_missing_text", proc.stdout)
        self.assertNotIn("private-notes", proc.stdout)

    def test_unapproved_plan_dry_run_is_aggregate_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            proc = run_script(RUNNER, "--plan", str(plan_path), "--max-jobs", "2")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "dry_run")
        self.assertEqual(summary["jobs_selected"], 2)
        self.assertEqual(summary["approval_attestation"]["status"], "not_requested")
        self.assertFalse(summary["approval_attestation"]["runtime_enforced"])
        self.assertEqual(summary["results_status"], {"skipped": 2})
        self.assertEqual(summary["scale_readiness_attestation"]["status"], "blocked")
        self.assertFalse(summary["scale_readiness_attestation"]["canary"]["verified"])
        self.assertFalse(summary["scale_readiness_attestation"]["full_run"]["verified"])
        self.assertNotIn("f_missing_text", proc.stdout)
        self.assertNotIn("private-notes", proc.stdout)

    def test_unapproved_execute_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            gate = root / "extraction-lane-readiness-gate.json"
            write_global_gate(gate)
            proc = run_script(
                RUNNER,
                "--plan",
                str(plan_path),
                "--execute",
                "--max-jobs",
                "1",
                "--extraction-readiness-gate",
                str(gate),
            )

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "approval_required")
        self.assertEqual(summary["approval_attestation"]["status"], "blocked")
        self.assertTrue(summary["approval_attestation"]["runtime_enforced"])
        self.assertFalse(summary["approval_attestation"]["plan_approved"])
        self.assertEqual(summary["results_status"], {"skipped": 1})
        self.assertFalse(summary["global_execution_preflight"]["allowed"])
        self.assertEqual(summary["global_execution_preflight"]["status"], "canary_approval_token_required")
        self.assertFalse(summary["global_execution_preflight"]["approval_token_valid"])
        self.assertEqual(summary["scale_readiness_attestation"]["status"], "pending_canary")
        self.assertFalse(summary["scale_readiness_attestation"]["full_run"]["verified"])

    def test_approved_execute_captures_private_outputs_and_cleans_downloads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=True)
            gate = root / "extraction-lane-readiness-gate.json"
            fake_extractor = root / "fake_extractor.py"
            fake_files = root / "fake_files.py"
            run_dir = root / "run"
            write_global_gate(gate)
            write_fake_extractor(fake_extractor)
            write_fake_files(fake_files)
            proc = run_script(
                RUNNER,
                "--plan",
                str(plan_path),
                "--execute",
                "--max-jobs",
                "1",
                "--max-planned-bytes",
                str(10 * 1024 * 1024),
                "--extractor-script",
                str(fake_extractor),
                "--files-command",
                f"python3 {fake_files}",
                "--output-dir",
                str(run_dir),
                "--extraction-readiness-gate",
                str(gate),
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)
            results = [json.loads(line) for line in (run_dir / "search-index-run-results.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
            attestation = json.loads(Path(results[0]["runtime_attestation"]).read_text(encoding="utf-8"))
            extractor_stdout = Path(results[0]["logs"]["extractor_stdout"]).read_text(encoding="utf-8")
            indexer_stdout = Path(results[0]["logs"]["indexer_stdout"]).read_text(encoding="utf-8")
            search_text = (Path(results[0]["private_job_dir"]) / "search-index-text.txt").read_text(encoding="utf-8")
            attestation_text = Path(results[0]["runtime_attestation"]).read_text(encoding="utf-8")

        self.assertEqual(summary["status"], "completed")
        self.assertEqual(summary["approval_attestation"]["status"], "verified")
        self.assertTrue(summary["approval_attestation"]["plan_approved"])
        self.assertTrue(summary["approval_attestation"]["approval_note_present"])
        self.assertRegex(summary["approval_attestation"]["approval_note_sha256"], r"^[a-f0-9]{64}$")
        self.assertTrue(summary["global_execution_preflight"]["allowed"])
        self.assertEqual(summary["global_execution_preflight"]["status"], "canary_allowed_pending_global_completion")
        self.assertTrue(summary["global_execution_preflight"]["approval_token_valid"])
        self.assertEqual(summary["jobs_completed"], 1)
        self.assertEqual(summary["results_status"], {"indexed": 1})
        self.assertEqual(summary["runtime_attestation"]["status"], "ok")
        self.assertEqual(summary["search_probe_attestation"]["status"], "ok")
        self.assertEqual(summary["search_probe_attestation"]["probes"], 1)
        self.assertEqual(summary["search_probe_attestation"]["matched_expected_file_probes"], 1)
        self.assertEqual(summary["search_probe_attestation"]["failed_probes"], 0)
        self.assertLessEqual(
            summary["search_probe_attestation"]["max_latency_ms"],
            summary["search_probe_attestation"]["latency_budget_ms"],
        )
        self.assertEqual(summary["runtime_attestation"]["jobs"], 1)
        self.assertEqual(summary["runtime_attestation"]["immutable_bytes_attested_jobs"], 1)
        self.assertEqual(summary["runtime_attestation"]["metadata_only_attested_jobs"], 1)
        self.assertEqual(summary["runtime_attestation"]["s3_mutation_attempted_jobs"], 0)
        self.assertRegex(summary["runtime_attestation"]["attestation_files_sha256"], r"^[a-f0-9]{64}$")
        self.assertEqual(summary["scale_readiness_attestation"]["status"], "canary_verified")
        self.assertEqual(summary["scale_readiness_attestation"]["search_probe_status"], "ok")
        self.assertTrue(summary["scale_readiness_attestation"]["canary"]["verified"])
        self.assertTrue(summary["scale_readiness_attestation"]["canary"]["requires_search_probe_ok"])
        self.assertFalse(summary["scale_readiness_attestation"]["full_run"]["verified"])
        self.assertTrue(summary["scale_readiness_attestation"]["full_run"]["requires_search_probe_ok"])
        self.assertGreater(summary["scale_readiness_attestation"]["full_run"]["remaining_jobs"], 0)
        self.assertRegex(summary["selected_private_ids_sha256"], r"^[a-f0-9]{64}$")
        self.assertEqual(summary["selected_private_ids_sha256"], summary["result_private_ids_sha256"])
        self.assertIn("file_id", results[0])
        self.assertEqual(results[0]["runtime_attestation_status"], "ok")
        self.assertTrue(results[0]["immutable_bytes_attested"])
        self.assertTrue(results[0]["metadata_only_attested"])
        self.assertEqual(attestation["status"], "ok")
        self.assertTrue(attestation["canonical_bytes_policy"]["canonical_s3_keys_immutable"])
        self.assertTrue(attestation["canonical_bytes_policy"]["source_bytes_read_only"])
        self.assertFalse(attestation["canonical_bytes_policy"]["s3_mutation_attempted_by_runner"])
        self.assertTrue(attestation["write_policy"]["metadata_only"])
        self.assertEqual(attestation["write_policy"]["allowed_durable_write_surface"], "files search-index add")
        self.assertIn("f_", extractor_stdout)
        self.assertIn("warehouse renewal summary", indexer_stdout)
        self.assertIn("files.db", indexer_stdout)
        self.assertIn("warehouse renewal summary", search_text)
        self.assertNotIn("file_id", search_text)
        self.assertFalse((Path(results[0]["private_job_dir"]) / "downloads").exists())
        self.assertNotIn("f_missing_text", proc.stdout)
        self.assertNotIn('"file_id"', proc.stdout)
        self.assertNotIn("warehouse renewal", proc.stdout)
        self.assertNotIn("f_missing_text", attestation_text)
        self.assertNotIn("warehouse renewal", attestation_text)

    def test_execute_respects_planned_bytes_cap_before_running_extractor(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=True)
            gate = root / "extraction-lane-readiness-gate.json"
            fake_extractor = root / "fake_extractor.py"
            fake_files = root / "fake_files.py"
            write_global_gate(gate)
            write_fake_extractor(fake_extractor)
            write_fake_files(fake_files)
            proc = run_script(
                RUNNER,
                "--plan",
                str(plan_path),
                "--execute",
                "--max-jobs",
                "1",
                "--max-planned-bytes",
                "1",
                "--extractor-script",
                str(fake_extractor),
                "--files-command",
                f"python3 {fake_files}",
                "--extraction-readiness-gate",
                str(gate),
            )

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "planned_bytes_cap_exceeded")
        self.assertEqual(summary["approval_attestation"]["status"], "verified")
        self.assertEqual(summary["approval_attestation"]["decision"], "planned_bytes_cap_exceeded")
        self.assertEqual(summary["results_status"], {"skipped": 1})
        self.assertNotIn("f_missing_text", proc.stdout)

    def test_approved_scale_execute_is_blocked_by_global_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=True)
            gate = root / "extraction-lane-readiness-gate.json"
            write_global_gate(gate)
            fake_extractor = root / "fake_extractor.py"
            fake_files = root / "fake_files.py"
            write_fake_extractor(fake_extractor)
            write_fake_files(fake_files)
            proc = run_script(
                RUNNER,
                "--plan",
                str(plan_path),
                "--execute",
                "--execution-scope",
                "scale",
                "--max-jobs",
                "1",
                "--max-planned-bytes",
                str(10 * 1024 * 1024),
                "--extractor-script",
                str(fake_extractor),
                "--files-command",
                f"python3 {fake_files}",
                "--extraction-readiness-gate",
                str(gate),
            )

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "global_execution_preflight_blocked")
        self.assertEqual(summary["global_execution_preflight"]["status"], "scale_blocked_by_global_gate")
        self.assertFalse(summary["global_execution_preflight"]["allowed"])
        self.assertEqual(summary["results_status"], {"skipped": 1})
        self.assertNotIn("f_missing_text", proc.stdout)

    def test_validator_rejects_duplicate_private_ids_without_printing_them(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            plan_data = json.loads(plan_path.read_text(encoding="utf-8"))
            shard = Path(plan_data["shard_entries"][0]["manifest"])
            rows = [json.loads(line) for line in shard.read_text(encoding="utf-8").splitlines() if line.strip()]
            rows.append(rows[0])
            shard.write_text("\n".join(json.dumps(row, sort_keys=True) for row in rows) + "\n", encoding="utf-8")
            plan_data["shard_entries"][0]["jobs"] = len(rows)
            plan_data["shard_entries"][0]["bytes"] = sum(int(row.get("size") or 0) for row in rows)
            import hashlib
            plan_data["shard_entries"][0]["manifest_sha256"] = hashlib.sha256(shard.read_bytes()).hexdigest()
            plan_data["jobs_planned"] = len(rows)
            plan_data["bytes_planned"] = plan_data["shard_entries"][0]["bytes"]
            plan_path.write_text(json.dumps(plan_data, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(VALIDATOR, "--plan", str(plan_path))

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        error_codes = {error["code"] for error in summary["errors"]}
        self.assertIn("duplicate_private_file_ids", error_codes)
        self.assertNotIn("f_missing_text", proc.stdout)

    def test_validator_rejects_tampered_approval_attestation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            plan_data = json.loads(plan_path.read_text(encoding="utf-8"))
            plan_data["approval_attestation"]["status"] = "approved"
            plan_path.write_text(json.dumps(plan_data, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(VALIDATOR, "--plan", str(plan_path))

        self.assertNotEqual(proc.returncode, 0)
        codes = {error["code"] for error in json.loads(proc.stdout)["errors"]}
        self.assertIn("approval_attestation_mismatch", codes)

    def test_validator_rejects_aggregate_dimension_count_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            plan_data = json.loads(plan_path.read_text(encoding="utf-8"))
            plan_data["planned"]["aggregate"]["by_lane"][0]["count"] += 1
            plan_path.write_text(json.dumps(plan_data, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(VALIDATOR, "--plan", str(plan_path))

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        error_codes = {error["code"] for error in summary["errors"]}
        self.assertIn("aggregate_dimension_count_mismatch", error_codes)
        self.assertNotIn("f_missing_text", proc.stdout)

    def test_validator_rejects_declared_total_reconciliation_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            plan_data = json.loads(plan_path.read_text(encoding="utf-8"))
            plan_data["declared_totals"]["active_files"] += 1
            plan_path.write_text(json.dumps(plan_data, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(VALIDATOR, "--plan", str(plan_path))

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        error_codes = {error["code"] for error in summary["errors"]}
        self.assertIn("declared_reconciled_count_mismatch", error_codes)
        self.assertIn("aggregate_total_count_mismatch", error_codes)


if __name__ == "__main__":
    unittest.main()
