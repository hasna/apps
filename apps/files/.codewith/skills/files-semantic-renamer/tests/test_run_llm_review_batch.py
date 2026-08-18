#!/usr/bin/env python3
"""Offline regression tests for the open-files LLM review runner."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "run_llm_review_batch.py"
SPEC = importlib.util.spec_from_file_location("run_llm_review_batch", SCRIPT)
assert SPEC and SPEC.loader
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class DirectApiRunnerTests(unittest.TestCase):
    def test_parse_json_object_accepts_fenced_json(self) -> None:
        parsed = runner.parse_json_object('```json\n{"status":"done","jobs_seen":1}\n```')
        self.assertEqual(parsed["status"], "done")
        self.assertEqual(parsed["jobs_seen"], 1)

    def test_safe_direct_jobs_filters_private_manifest_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            review_artifact = Path(tmp) / "review.json"
            review_artifact.write_text(json.dumps({"redaction": "bounded", "review": {}}), encoding="utf-8")
            jobs, errors = runner.safe_direct_jobs([
                {
                    "file_id": "f_safe",
                    "owner": "finance",
                    "expected_ext": "pdf",
                    "review_artifact": str(review_artifact),
                    "private_metadata": {"file_name": "private-name.pdf"},
                    "source_ref": "s3://private/object",
                    "target_path": "private/path.pdf",
                    "labels": ["private"],
                }
            ])

        self.assertEqual(errors, [])
        self.assertEqual(len(jobs), 1)
        self.assertNotIn("private_metadata", jobs[0])
        self.assertNotIn("source_ref", jobs[0])
        self.assertNotIn("target_path", jobs[0])
        self.assertNotIn("labels", jobs[0])
        self.assertEqual(jobs[0]["review_artifact"]["redaction"], "bounded")

    def test_openrouter_retry_falls_back_to_json_object_for_schema_rejection(self) -> None:
        calls: list[bool] = []
        original_completion = runner.openrouter_chat_completion
        try:
            def fake_completion(*args: Any, **kwargs: Any) -> tuple[dict[str, Any], dict[str, Any]]:
                strict = bool(kwargs["strict_schema"])
                calls.append(strict)
                if strict:
                    raise runner.DirectApiError("OpenRouter HTTP 400", status=400)
                return (
                    {"status": "done", "jobs_seen": 1, "proposals": [], "errors": []},
                    {"id": "resp_safe", "model": "model_safe", "usage": {"total_tokens": 3}},
                )

            runner.openrouter_chat_completion = fake_completion
            response, metadata = runner.openrouter_chat_with_retry(
                "key",
                "model",
                "prompt",
                {},
                10,
                128,
                0.0,
                None,
                False,
                retries=0,
                retry_base_seconds=0,
            )
        finally:
            runner.openrouter_chat_completion = original_completion

        self.assertEqual(calls, [True, False])
        self.assertEqual(response["status"], "done")
        self.assertEqual(metadata["attempts"][0]["schema_mode"], "json_object")

    def test_openrouter_retry_retries_transient_errors(self) -> None:
        calls = 0
        sleeps: list[float] = []
        original_completion = runner.openrouter_chat_completion
        original_sleep = runner.time.sleep
        try:
            def fake_completion(*args: Any, **kwargs: Any) -> tuple[dict[str, Any], dict[str, Any]]:
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise runner.DirectApiError("OpenRouter HTTP 503", status=503)
                return (
                    {"status": "done", "jobs_seen": 1, "proposals": [], "errors": []},
                    {"id": "resp_safe", "model": "model_safe", "usage": {"total_tokens": 5}},
                )

            runner.openrouter_chat_completion = fake_completion
            runner.time.sleep = sleeps.append
            response, metadata = runner.openrouter_chat_with_retry(
                "key",
                "model",
                "prompt",
                {},
                10,
                128,
                0.0,
                "throughput",
                False,
                retries=2,
                retry_base_seconds=0.25,
            )
        finally:
            runner.openrouter_chat_completion = original_completion
            runner.time.sleep = original_sleep

        self.assertEqual(response["status"], "done")
        self.assertEqual(calls, 2)
        self.assertEqual(sleeps, [0.25])
        self.assertEqual([attempt["status"] for attempt in metadata["attempts"]], ["error", "ok"])

    def test_run_direct_api_review_writes_redacted_audit_and_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            review_artifact = root / "review.json"
            review_artifact.write_text(
                json.dumps({
                    "file_id": "f_private",
                    "content_ready": True,
                    "review": {"redacted_excerpt": "bounded safe excerpt"},
                    "redaction": "bounded review artifact",
                }),
                encoding="utf-8",
            )
            proposals = root / "proposals.jsonl"
            errors = root / "errors.jsonl"
            final_output = root / "final.json"
            audit_output = root / "audit.json"
            captured_prompts: list[str] = []
            original_key = runner.openrouter_api_key
            original_retry = runner.openrouter_chat_with_retry
            try:
                def fake_key(secret_name: str) -> str:
                    self.assertEqual(secret_name, "secret/name")
                    return "secret-value"

                def fake_retry(
                    api_key: str,
                    model: str,
                    prompt: str,
                    schema: dict[str, Any],
                    timeout: int,
                    max_tokens: int,
                    temperature: float,
                    provider_sort: str | None,
                    allow_data_collection: bool,
                    retries: int,
                    retry_base_seconds: float,
                ) -> tuple[dict[str, Any], dict[str, Any]]:
                    captured_prompts.append(prompt)
                    self.assertEqual(api_key, "secret-value")
                    self.assertEqual(provider_sort, "throughput")
                    self.assertFalse(allow_data_collection)
                    return (
                        {
                            "status": "done",
                            "jobs_seen": 1,
                            "proposals": [
                                {
                                    "job_ref": "job-000001",
                                    "canonical_name": "safe-document.pdf",
                                    "target_path": "finance/safe-document.pdf",
                                    "document_kind": "document",
                                    "confidence": "low",
                                    "requires_review": True,
                                    "reason": "Derived from bounded artifact status.",
                                }
                            ],
                            "errors": [],
                        },
                        {
                            "id": "resp_safe",
                            "model": "mimo-safe",
                            "usage": {"total_tokens": 10, "cost": 0.001},
                            "attempts": [{"attempt": 1, "status": "ok", "schema_mode": "json_schema"}],
                            "elapsed_seconds": 0.1,
                        },
                    )

                runner.openrouter_api_key = fake_key
                runner.openrouter_chat_with_retry = fake_retry
                runner.run_direct_api_review(
                    [
                        {
                            "file_id": "f_private",
                            "owner": "finance",
                            "expected_ext": "pdf",
                            "review_artifact": str(review_artifact),
                            "private_metadata": {"file_name": "private-name.pdf"},
                            "source_ref": "s3://private/object",
                            "target_path": "private/path.pdf",
                        }
                    ],
                    proposals,
                    errors,
                    final_output,
                    audit_output,
                    "xiaomi/mimo-v2.5-pro",
                    "secret/name",
                    60,
                    512,
                    0.0,
                    "throughput",
                    False,
                    2,
                    0,
                )
            finally:
                runner.openrouter_api_key = original_key
                runner.openrouter_chat_with_retry = original_retry

            prompt = captured_prompts[0]
            self.assertNotIn("private-name.pdf", prompt)
            self.assertNotIn("s3://private/object", prompt)
            self.assertNotIn("private/path.pdf", prompt)

            self.assertEqual(runner.line_count(proposals), 1)
            self.assertEqual(runner.line_count(errors), 0)
            final = json.loads(final_output.read_text(encoding="utf-8"))
            self.assertEqual(final["jobs_seen"], 1)
            self.assertEqual(final["proposals_written"], 1)
            audit = json.loads(audit_output.read_text(encoding="utf-8"))
            self.assertEqual(audit["status"], "ok")
            self.assertEqual(audit["provider_data_collection"], "deny")
            self.assertEqual(audit["egress_attestation"]["endpoint_host"], "openrouter.ai")
            self.assertEqual(audit["egress_attestation"]["provider_data_collection"], "deny")
            self.assertEqual(audit["payload_attestation"]["job_identity_policy"], "synthetic-job-ref")
            self.assertFalse(audit["payload_attestation"]["real_file_ids_sent"])
            self.assertFalse(audit["payload_attestation"]["raw_file_bytes_sent"])
            self.assertFalse(audit["payload_attestation"]["raw_extracts_sent"])
            self.assertFalse(audit["payload_attestation"]["object_keys_sent"])
            self.assertFalse(audit["payload_attestation"]["source_refs_sent"])
            self.assertFalse(audit["payload_attestation"]["filenames_sent"])
            self.assertFalse(audit["payload_attestation"]["secret_values_sent"])
            self.assertEqual(audit["payload_attestation"]["payload_sensitive_key_hits"], 0)
            self.assertEqual(audit["usage"]["total_tokens"], 10)
            audit_text = audit_output.read_text(encoding="utf-8")
            self.assertNotIn("f_private", audit_text)
            self.assertNotIn("safe-document.pdf", audit_text)
            self.assertNotIn("private-name.pdf", audit_text)

    def test_add_direct_usage_totals_accepts_numeric_strings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            audit_output = Path(tmp) / "audit.json"
            audit_output.write_text(
                json.dumps({
                    "usage": {
                        "prompt_tokens": "10",
                        "completion_tokens": 5,
                        "total_tokens": "15",
                        "cost": "0.0125",
                    }
                }),
                encoding="utf-8",
            )
            totals = runner.add_direct_usage_totals(
                {
                    "prompt_tokens": 1.0,
                    "completion_tokens": 2.0,
                    "total_tokens": 3.0,
                    "cost": 0.5,
                },
                audit_output,
            )

        self.assertEqual(totals["prompt_tokens"], 11.0)
        self.assertEqual(totals["completion_tokens"], 7.0)
        self.assertEqual(totals["total_tokens"], 18.0)
        self.assertAlmostEqual(totals["cost"], 0.5125)

    def test_llm_runtime_attestation_is_hash_only_and_metadata_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "chunk.manifest.jsonl"
            proposals = root / "chunk.proposals.jsonl"
            errors = root / "chunk.errors.jsonl"
            final_output = root / "chunk.final.json"
            direct_audit = root / "chunk.direct-api-audit.json"
            review_artifact = root / "job-000001.review.json"
            attestation_path = root / "chunk.runtime-attestations.jsonl"
            manifest.write_text('{"file_id":"f_private","owner":"finance"}\n', encoding="utf-8")
            proposals.write_text(
                json.dumps({
                    "file_id": "f_private",
                    "canonical_name": "safe-document.pdf",
                    "target_path": "finance/safe-document.pdf",
                    "document_kind": "document",
                    "confidence": "low",
                    "requires_review": True,
                    "reason": "Derived from bounded artifact status.",
                }) + "\n",
                encoding="utf-8",
            )
            errors.write_text("", encoding="utf-8")
            final_output.write_text(json.dumps({"status": "done", "jobs_seen": 1}), encoding="utf-8")
            direct_audit.write_text(
                json.dumps({
                    "status": "ok",
                    "egress_attestation": {
                        "status": "ok",
                        "allowed_hosts": ["openrouter.ai"],
                        "endpoint_host": "openrouter.ai",
                        "provider_data_collection_denied": True,
                    },
                    "payload_attestation": {
                        "status": "ok",
                        "payload_class": "sanitized-bounded-review-jobs",
                        "payload_sha256": "0" * 64,
                        "prompt_sha256": "1" * 64,
                        "schema_sha256": "2" * 64,
                        "real_file_ids_sent": False,
                        "raw_file_bytes_sent": False,
                        "raw_extracts_sent": False,
                        "object_keys_sent": False,
                        "source_refs_sent": False,
                        "filenames_sent": False,
                        "secret_values_sent": False,
                        "payload_sensitive_key_hits": 0,
                        "payload_sensitive_value_marker_hits": 0,
                    },
                }),
                encoding="utf-8",
            )
            review_artifact.write_text(json.dumps({"redaction": "bounded"}), encoding="utf-8")

            runner.write_llm_chunk_runtime_attestations(
                1,
                [
                    {
                        "file_id": "f_private",
                        "owner": "finance",
                        "extractor_lane": "pdf",
                        "mime": "application/pdf",
                        "expected_ext": "pdf",
                        "review_artifact": str(review_artifact),
                        "artifact_ready": True,
                        "content_ready": True,
                    }
                ],
                attestation_path,
                "direct-api",
                validation_ok=True,
                artifact_paths={
                    "manifest": manifest,
                    "proposals": proposals,
                    "errors": errors,
                    "final_output": final_output,
                    "direct_api_audit": direct_audit,
                },
            )
            summary = runner.llm_runtime_attestation_summary([attestation_path])
            attestation_text = attestation_path.read_text(encoding="utf-8")
            rows = [json.loads(line) for line in attestation_text.splitlines() if line.strip()]

        self.assertEqual(summary["status"], "ok")
        self.assertEqual(summary["jobs"], 1)
        self.assertEqual(summary["provider_payload_policy_attested_jobs"], 1)
        self.assertEqual(summary["provider_payload_policy_violation_jobs"], 0)
        self.assertEqual(summary["immutable_bytes_attested_jobs"], 1)
        self.assertEqual(summary["metadata_only_attested_jobs"], 1)
        self.assertEqual(summary["metadata_apply_attempted_jobs"], 0)
        self.assertEqual(summary["s3_mutation_attempted_jobs"], 0)
        self.assertEqual(rows[0]["status"], "ok")
        self.assertEqual(rows[0]["provider_payload_policy"]["status"], "ok")
        self.assertFalse(rows[0]["provider_payload_policy"]["real_file_ids_sent"])
        self.assertFalse(rows[0]["provider_payload_policy"]["raw_file_bytes_sent"])
        self.assertFalse(rows[0]["provider_payload_policy"]["raw_extracts_sent"])
        self.assertFalse(rows[0]["provider_payload_policy"]["object_keys_sent"])
        self.assertFalse(rows[0]["provider_payload_policy"]["source_refs_sent"])
        self.assertFalse(rows[0]["provider_payload_policy"]["filenames_sent"])
        self.assertFalse(rows[0]["provider_payload_policy"]["secret_values_sent"])
        self.assertTrue(rows[0]["provider_payload_policy"]["provider_data_collection_denied"])
        self.assertTrue(rows[0]["provider_payload_policy"]["allowed_host_policy_matched"])
        self.assertTrue(rows[0]["canonical_bytes_policy"]["canonical_s3_keys_immutable"])
        self.assertTrue(rows[0]["write_policy"]["metadata_only"])
        self.assertFalse(rows[0]["write_policy"]["metadata_apply_attempted"])
        self.assertNotIn("f_private", attestation_text)
        self.assertNotIn("safe-document.pdf", attestation_text)

    def test_runner_state_tracks_completed_chunks_without_private_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_path = root / "state.json"
            state = runner.initial_runner_state(
                root / "manifest.jsonl",
                root / "out",
                "mimo",
                "xiaomi/mimo-v2.5-pro",
                "direct-api",
                jobs_scheduled=4,
                chunks_total=2,
            )
            runner.record_chunk_state(
                state,
                1,
                "completed",
                jobs=2,
                proposal_rows=2,
                error_rows=0,
                outputs={"proposals": "chunk-0001.proposals.jsonl"},
            )
            runner.record_chunk_state(
                state,
                2,
                "failed",
                jobs=2,
                proposal_rows=1,
                error_rows=1,
                outputs={"errors": "chunk-0002.errors.jsonl"},
                reason="runner_validation",
            )
            runner.write_runner_state(state_path, state)
            loaded = runner.load_runner_state(state_path)

        self.assertEqual(runner.completed_chunk_indexes(loaded), {1})
        self.assertEqual(runner.state_error_rows(loaded), 1)
        state_text = json.dumps(loaded)
        self.assertNotIn("f_private", state_text)
        self.assertNotIn("safe-document.pdf", state_text)
        self.assertIn("state omits manifest rows", loaded["redaction"])


if __name__ == "__main__":
    unittest.main()
