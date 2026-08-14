#!/usr/bin/env python3
"""Offline tests for adversarial review packets."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_adversarial_review_packet.py"


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


class BuildAdversarialReviewPacketTests(unittest.TestCase):
    def test_builds_two_reviewer_packet_without_private_markers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            output = root / "packet"
            search_packet = source / "search-index-approval-packet.json"
            validation = source / "search-index-plan-validation.json"
            search_runtime = source / "search-index-runtime.json"
            duplicate_attestation = source / "duplicate-preserve-attestation.json"
            stage_dependency_gate = source / "stage-dependency-gate.json"
            stage_dependency_verification = source / "stage-dependency-verification.json"
            campaign = source / "campaign-plan.json"
            campaign_runtime = source / "campaign-runtime.json"
            provider_readiness = source / "provider-readiness.json"
            campaign_results = source / "campaign-results-summary.json"
            deferred_media = source / "deferred-media-summary.json"
            extraction_readiness = source / "extraction-readiness-gate.json"
            extraction_readiness_verification = source / "extraction-readiness-verification.json"
            worker_image = source / "extraction-worker-image-verification.json"
            approval_dashboard = source / "extraction-approval-dashboard.json"
            approval_request_packet = source / "approval-request-packet.json"
            approval_request_verification = source / "approval-request-packet-verification.json"
            replacement_readiness = source / "replacement-readiness-gate.json"

            search_packet.write_text(
                json.dumps(
                    {
                        "kind": "search_index_population_approval_packet",
                        "plan_status": "approval_required",
                        "approved": False,
                        "approval_required": True,
                        "coverage": {"active_files": 10, "indexed_files": 0, "missing_files": 10},
                        "declared_totals": {
                            "active_files": 12,
                            "planned_jobs": 10,
                            "exempt_files": 2,
                            "reconciled": True,
                        },
                        "planned": {"jobs": 10, "bytes": 1234, "shards": 1, "aggregate": {"readable_now_text": 10}},
                        "completeness": {
                            "aggregate": {
                                "totals": {"rows": 12, "bytes": 1500},
                                "by_outcome": [
                                    {"key": "planned", "count": 10, "bytes": 1234},
                                    {"key": "exempt_duplicate", "count": 2, "bytes": 266},
                                ],
                            },
                            "outcome_policy": {"planned": "selected", "exempt_duplicate": "duplicate"},
                        },
                        "validation": {"status": "ok", "errors": [], "warnings": [], "plan_private_id_leaks": 0},
                        "commands": {"validate": "python3 validate.py"},
                    }
                ),
                encoding="utf-8",
            )
            validation.write_text(
                json.dumps({"status": "ok", "errors": [], "warnings": [], "plan_private_id_leaks": 0}),
                encoding="utf-8",
            )
            search_runtime.write_text(
                json.dumps(
                    {
                        "status": "approval_required",
                        "approval_attestation": {
                            "status": "blocked",
                            "decision": "approval_required",
                            "runtime_enforced": True,
                            "execute_requested": True,
                            "plan_approved": False,
                            "approval_note_present": False,
                            "validation_status": "ok",
                            "jobs_selected": 1,
                        },
                        "global_execution_preflight": {
                            "status": "canary_approval_token_required",
                            "allowed": False,
                            "reason": "explicit canary execution requires a validated approval token",
                            "execution_scope": "canary",
                            "gate_present": True,
                            "gate_status": "pending_completion",
                            "requires_operator_approval_before_scale": True,
                            "full_extraction_complete": False,
                            "hard_blocker_lanes": 0,
                            "pending_lanes": 8,
                            "selected_jobs": 1,
                            "selected_bytes": 100,
                            "max_canary_jobs": 1,
                            "max_canary_bytes": 1000,
                            "approval_token_present": False,
                            "approval_token_valid": False,
                        },
                        "runtime_attestation": {
                            "status": "not_executed",
                            "jobs": 0,
                            "redaction": "runtime attestation is populated only after approved job execution",
                        },
                        "search_probe_attestation": {
                            "status": "not_executed",
                            "probes": 0,
                            "redaction": "search probe is populated only after approved search-index execution",
                        },
                        "scale_readiness_attestation": {
                            "status": "pending_canary",
                            "selected_jobs": 1,
                            "completed_jobs": 0,
                            "planned_jobs": 10,
                            "search_probe_status": "not_executed",
                            "canary": {"scope": "canary", "verified": False},
                            "full_run": {"verified": False, "remaining_jobs": 10},
                        },
                    }
                ),
                encoding="utf-8",
            )
            duplicate_attestation.write_text(
                json.dumps(
                    {
                        "kind": "open_files_duplicate_preserve_policy_attestation",
                        "status": "attested_with_pending_index",
                        "policy_ok": True,
                        "search_index_ready": False,
                        "blockers": ["search index population still pending for planned survivor rows"],
                        "duplicate_policy": {
                            "duplicate_non_survivors_are_preserved": True,
                            "duplicate_non_survivors_are_not_unique_search_documents": True,
                            "survivor_must_be_planned_or_already_indexed": True,
                            "canonical_s3_bytes_remain_immutable": True,
                            "metadata_apply_must_not_delete_duplicate_rows": True,
                        },
                        "planner_reconciliation": {
                            "exempt_duplicate_rows": 2,
                            "exempt_duplicate_bytes": 266,
                            "exempt_duplicate_missing_rows": 2,
                            "duplicate_counts_match_db": True,
                            "duplicate_bytes_match_db": True,
                            "declared_totals_reconciled": True,
                            "unplanned_in_scope_files": 0,
                        },
                        "organization_duplicates": {
                            "active_duplicate_groups": 2,
                            "active_duplicate_group_rows": 4,
                            "duplicate_non_survivor_rows": 2,
                            "duplicate_survivor_rows": 2,
                            "groups_with_planned_survivor": 2,
                            "groups_with_indexed_survivor": 0,
                            "groups_without_active_survivor": 0,
                            "groups_without_planned_or_indexed_survivor": 0,
                            "duplicate_non_survivor_rows_accidentally_planned": 0,
                        },
                        "private_manifest_audit": {
                            "shard_manifests_read": 1,
                            "shard_manifest_errors": 0,
                            "planned_private_ids_count": 10,
                        },
                        "scale_readiness": {
                            "duplicate_policy_attested": True,
                            "requires_search_index_ready": True,
                            "approved_to_scale": False,
                        },
                    }
                ),
                encoding="utf-8",
            )
            stage_dependency_gate.write_text(
                json.dumps(
                    {
                        "kind": "open_files_stage_dependency_gate",
                        "version": 1,
                        "status": "blocked",
                        "approved_to_scale": False,
                        "current_stage_order": 20,
                        "first_blocking_stage": "extraction_lane_readiness",
                        "blocking_stage_count": 8,
                        "hard_blocking_stage_count": 7,
                        "deferred_stage_count": 1,
                        "scale_rules": {
                            "requires_duplicate_policy_attested": True,
                            "requires_extraction_lanes_complete": True,
                            "requires_final_media_pass_for_full_replacement": True,
                            "requires_operator_approval_items_resolved": True,
                            "requires_search_index_canary_and_full_population": True,
                            "requires_llm_provider_readiness": True,
                            "requires_llm_rename_canary_full_campaign_and_runtime_attestation": True,
                            "requires_metadata_apply_after_review_only": True,
                        },
                        "stages": [
                            {
                                "key": "duplicate_preserve_policy",
                                "order": 10,
                                "status": "complete",
                                "complete": True,
                                "required_for_scale": True,
                                "deferred_until_final_pass": False,
                                "blockers": [],
                                "evidence": {"present": True, "policy_ok": True},
                            },
                            {
                                "key": "extraction_lane_readiness",
                                "order": 20,
                                "status": "blocked",
                                "complete": False,
                                "required_for_scale": True,
                                "deferred_until_final_pass": False,
                                "blockers": ["pending extraction lanes remain"],
                                "evidence": {"present": True, "pending_lanes": 3},
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )
            stage_dependency_verification.write_text(
                json.dumps(
                    {
                        "kind": "open_files_stage_dependency_gate_verification",
                        "version": 1,
                        "status": "ok",
                        "gate_status": "blocked",
                        "approved_to_scale": False,
                        "summary": {
                            "stages": 10,
                            "blocking_stage_count": 8,
                            "hard_blocking_stage_count": 7,
                            "deferred_stage_count": 1,
                            "first_blocking_stage": "extraction_lane_readiness",
                            "current_stage_order": 20,
                        },
                        "gates": {
                            "stage_order_complete_set": True,
                            "stage_order_numbers_ok": True,
                            "scale_rules_ok": True,
                            "counts_consistent": True,
                            "first_blocker_consistent": True,
                            "status_consistent": True,
                            "approval_consistent": True,
                        },
                        "source_artifacts": {"expected": 7, "present": 7, "missing": []},
                        "errors": [],
                        "warnings": [],
                    }
                ),
                encoding="utf-8",
            )
            campaign.write_text(
                json.dumps(
                    {
                        "kind": "llm_review_campaign_plan",
                        "status": "approval_required",
                        "approved": False,
                        "worker_manifest_sanitized": True,
                        "approval_attestation": {"status": "approval_required", "approved": False},
                        "redaction_attestation": {"status": "ok", "shards": 1, "rows": 1},
                        "direct_provider_policy_attestation": {
                            "status": "ok",
                            "direct_provider_count": 1,
                            "allowed_hosts": ["openrouter.ai"],
                            "payload_class": "sanitized-bounded-review-jobs",
                            "job_identity_policy": "synthetic-job-ref",
                            "real_file_ids_sent": False,
                            "provider_data_collection_denied_by_default": True,
                            "provider_data_collection_allowed_count": 0,
                            "raw_file_bytes_sent": False,
                            "raw_extracts_sent": False,
                            "secret_values_sent": False,
                        },
                        "schedule_policy": {
                            "status": "ok",
                            "max_campaign_parallel": 1,
                            "default_account_max_parallel": 1,
                            "default_rate_limit_per_minute": 30,
                            "accounts": [
                                {
                                    "account_ref": "direct-api:openrouter:default",
                                    "shards": 1,
                                    "jobs": 1,
                                    "max_parallel": 1,
                                    "rate_limit_per_minute": 30,
                                }
                            ],
                            "providers": [{"provider": "mimo-direct", "shards": 1, "jobs": 1}],
                        },
                        "jobs_planned": 1,
                        "shards": 1,
                        "execute_commands": 0,
                        "provider_types": ["spark"],
                        "execution_modes": ["codewith"],
                        "commands": [],
                    }
                ),
                encoding="utf-8",
            )
            campaign_runtime.write_text(
                json.dumps(
                    {
                        "status": "approval_required",
                        "approval_attestation": {
                            "status": "blocked",
                            "decision": "approval_required",
                            "runtime_enforced": True,
                            "execute_requested": True,
                            "plan_approved": False,
                            "approval_note_present": False,
                            "validation_status": "ok",
                            "jobs_selected": 1,
                            "shards_selected": 1,
                            "execute_commands_in_plan": 0,
                        },
                        "global_execution_preflight": {
                            "status": "canary_approval_token_required",
                            "allowed": False,
                            "reason": "explicit canary execution requires a validated approval token",
                            "execution_scope": "canary",
                            "gate_present": True,
                            "gate_status": "pending_completion",
                            "requires_operator_approval_before_scale": True,
                            "full_extraction_complete": False,
                            "hard_blocker_lanes": 0,
                            "pending_lanes": 8,
                            "selected_jobs": 1,
                            "selected_bytes": None,
                            "max_canary_jobs": 10,
                            "max_canary_bytes": None,
                            "approval_token_present": False,
                            "approval_token_valid": False,
                        },
                    }
                ),
                encoding="utf-8",
            )
            provider_readiness.write_text(
                json.dumps(
                    {
                        "kind": "open_files_llm_provider_readiness",
                        "status": "ok",
                        "planned_routes": {
                            "account_ref_count": 1,
                            "direct_routes": ["direct-api:provider:default"],
                            "direct_gateways": ["provider"],
                            "codewith_profile_count": 0,
                            "codewith_tool_available": True,
                        },
                        "direct_provider_policy_gate": {
                            "status": "ok",
                            "direct_provider_count": 1,
                            "allowed_host_count": 1,
                            "checks": {
                                "status_ok": True,
                                "real_file_ids_not_sent": True,
                                "raw_file_bytes_not_sent": True,
                                "raw_extracts_not_sent": True,
                                "secret_values_not_sent": True,
                                "provider_data_collection_denied": True,
                                "provider_data_collection_allowed_count_zero": True,
                                "allowed_hosts_safe": True,
                            },
                        },
                        "schedule_gate": {
                            "status": "ok",
                            "account_count": 1,
                            "invalid_account_count": 0,
                            "max_campaign_parallel": 1,
                        },
                        "non_mutation_attestation": {
                            "provider_calls_made": False,
                            "corpus_bytes_mutated": False,
                            "s3_objects_mutated": False,
                            "metadata_rows_mutated": False,
                            "search_index_rows_mutated": False,
                        },
                        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
                        "errors": [],
                    }
                ),
                encoding="utf-8",
            )
            campaign_results.write_text(
                json.dumps(
                    {
                        "status": "not_started",
                        "approved": False,
                        "jobs_planned": 1,
                        "shards": 1,
                        "shard_states": {"missing": 1, "completed": 0, "incomplete": 0},
                        "proposal_rows": 0,
                        "error_rows": 0,
                        "coverage": {
                            "scheduled": 1,
                            "scheduled_unique": 1,
                            "proposals": 0,
                            "errors": 0,
                            "observed": 0,
                            "observed_unique": 0,
                            "missing": 1,
                            "extra": 0,
                            "duplicate_outputs": 0,
                            "duplicate_scheduled": 0,
                        },
                        "proposal_validation": {
                            "status": "skipped",
                            "rows": 0,
                            "errors": 0,
                            "duplicate_target_paths": None,
                            "duplicate_file_ids": None,
                        },
                        "rename_correctness_gate": {
                            "status": "pending",
                            "coverage_complete": False,
                            "schema_valid": False,
                            "error_free": True,
                            "proposal_rows": 0,
                            "error_rows": 0,
                            "canonical_name_rows": 0,
                            "target_path_rows": 0,
                            "basename_match_rows": 0,
                            "extension_expected_rows": 0,
                            "extension_preserved_rows": 0,
                            "requires_review_rows": 0,
                            "reason_present_rows": 0,
                            "confidence": {"high": 0, "medium": 0, "low": 0, "unknown": 0},
                            "duplicate_target_paths": None,
                            "duplicate_file_ids": None,
                            "low_confidence_requires_review_violations": 0,
                            "metadata_apply_ready": False,
                            "metadata_apply_blocker": "no proposals collected",
                        },
                        "runtime_attestation_gate": {
                            "status": "pending",
                            "expected_outputs": 1,
                            "attestation_rows": 0,
                            "missing_attestations": 1,
                            "invalid_attestation_rows": 0,
                            "statuses": {},
                            "immutable_bytes_attested_rows": 0,
                            "metadata_only_attested_rows": 0,
                            "metadata_apply_attempted_rows": 0,
                            "search_index_write_attempted_rows": 0,
                            "source_byte_write_attempted_rows": 0,
                            "s3_mutation_attempted_rows": 0,
                        },
                        "scale_readiness_attestation": {
                            "status": "pending_canary",
                            "planned_jobs": 1,
                            "observed_jobs": 0,
                            "canary": {
                                "scope": "none",
                                "verified": False,
                                "rename_gate_status": "pending",
                                "runtime_attestation_gate_status": "pending",
                            },
                            "full_run": {
                                "verified": False,
                                "remaining_jobs": 1,
                                "requires_canary_verified_first": True,
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )
            deferred_media.write_text(
                json.dumps(
                    {
                        "kind": "open_files_deferred_media_completion_audit",
                        "status": "deferred",
                        "totals": {
                            "active_media_files": 3,
                            "active_media_bytes": 12345,
                            "queued_media_files": 1,
                            "indexed_media_files": 1,
                            "unresolved_media_files": 2,
                        },
                        "completion_buckets": [
                            {"key": "deferred", "count": 1, "bytes": 100},
                            {"key": "queued", "count": 1, "bytes": 200},
                            {"key": "indexed", "count": 1, "bytes": 300},
                            {"key": "failed", "count": 0, "bytes": 0},
                            {"key": "extracted", "count": 0, "bytes": 0},
                            {"key": "duplicate_preserve", "count": 0, "bytes": 0},
                        ],
                        "retry_buckets": [
                            {"key": "retried", "count": 0, "bytes": 0},
                            {"key": "not_retried", "count": 3, "bytes": 600},
                        ],
                        "by_lane": [{"key": "needs_transcription", "count": 2, "bytes": 300}],
                        "by_media_kind": [{"key": "audio", "count": 2, "bytes": 300}],
                        "by_lane_completion": [{"key": "needs_transcription|deferred", "count": 1, "bytes": 100}],
                        "completion_gate": {
                            "final_media_pass_required": True,
                            "complete": False,
                            "cannot_hide_behind_boolean_deferral": True,
                        },
                    }
                ),
                encoding="utf-8",
            )
            extraction_readiness.write_text(
                json.dumps(
                    {
                        "kind": "open_files_extraction_lane_readiness_gate",
                        "status": "pending_completion",
                        "totals": {
                            "active_files": 10,
                            "sampled_files": 9,
                            "sampled_routed_files": 9,
                            "large_file_runner_required_files": 1,
                            "deferred_media_files": 3,
                        },
                        "status_counts": {
                            "ready": 4,
                            "degraded_provider_required": 2,
                            "deferred_media": 2,
                            "approval_required_large_file_runner": 1,
                        },
                        "gate": {
                            "all_expected_lanes_present": True,
                            "all_active_lanes_explicitly_routed": True,
                            "full_extraction_complete": False,
                            "requires_operator_approval_before_scale": True,
                            "requires_provider_or_tool_work": True,
                            "final_media_pass_required": True,
                            "cannot_hide_unknown_or_unimplemented_lanes": True,
                        },
                        "lanes": [
                            {
                                "lane": "needs_pdf_extractor",
                                "route_status": "approval_required_large_file_runner",
                                "active_files": 5,
                                "smoke": {"samples": 1, "routed": 1, "failed": 0, "not_implemented": 0, "skipped_size": 1},
                                "requirements": ["approved_large_file_runner_canary"],
                            },
                            {
                                "lane": "needs_video_pipeline",
                                "route_status": "deferred_media",
                                "active_files": 3,
                                "deferred_media_files": 3,
                                "requirements": ["run_final_media_transcription_keyframe_pass"],
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )
            extraction_readiness_verification.write_text(
                json.dumps(
                    {
                        "kind": "open_files_extraction_lane_readiness_gate_verification",
                        "version": 1,
                        "status": "ok",
                        "gate_status": "pending_completion",
                        "summary": {
                            "active_files": 10,
                            "pending_lanes": 3,
                            "hard_blocker_lanes": 0,
                            "status_counts": {
                                "ready": 4,
                                "degraded_provider_required": 2,
                                "deferred_media": 2,
                                "approval_required_large_file_runner": 1,
                            },
                        },
                        "checks": {
                            "source_artifacts_present": True,
                            "source_artifacts_current": True,
                            "semantic_projection_current": True,
                            "redaction_ok": True,
                            "expected_lanes_present": True,
                            "totals_consistent": True,
                            "gate_flags_consistent": True,
                        },
                        "source_artifacts": {
                            "expected_sources": 5,
                            "present_sources": 5,
                            "current_checked": True,
                            "current_mismatched": [],
                            "current_missing_paths": [],
                        },
                        "errors": [],
                        "warnings": [],
                    }
                ),
                encoding="utf-8",
            )
            worker_runtime_policy = {
                "status": "ok",
                "network_mode": "none",
                "network_disabled": True,
                "provider_egress_allowed": False,
                "arbitrary_url_fetch_allowed": False,
                "google_drive_access_allowed": False,
                "s3_object_access_allowed": False,
                "db_access_allowed": False,
                "corpus_mounts_allowed": False,
                "secret_env_allowed": False,
                "read_only_rootfs": True,
                "cap_drop_all": True,
                "no_new_privileges": True,
                "command_logs_hashed_only": True,
                "private_values_in_command": False,
            }
            worker_image.write_text(
                json.dumps(
                    {
                        "kind": "open_files_extraction_worker_image_verification",
                        "status": "ok",
                        "static": {
                            "status": "ok",
                            "errors": [],
                            "warnings": [],
                            "required_packages": ["file", "libarchive-tools", "p7zip-full", "python3", "unzip"],
                            "redaction_checks": {
                                "smoke_does_not_use_include_names": True,
                                "smoke_checks_hashed_names": True,
                                "smoke_checks_member_name_leaks": True,
                            },
                        },
                        "docker": {"status": "permission_denied", "path": "/usr/bin/docker"},
                        "runtime": None,
                        "worker_runtime_policy": worker_runtime_policy,
                        "next_actions": ["grant_docker_socket_or_ci_runner_access", "rerun_with_build_and_capture_worker_inventory"],
                    }
                ),
                encoding="utf-8",
            )
            approval_dashboard.write_text(
                json.dumps(
                    {
                        "kind": "open_files_extraction_approval_dashboard",
                        "status": "ready_for_operator_review",
                        "overall": {
                            "ready_for_operator_review": True,
                            "ready_approval_items": 5,
                            "approval_items": 5,
                            "blocked_or_missing_prep_items": [],
                            "final_media_pass_deferred": True,
                            "corpus_bytes_mutated": False,
                            "s3_objects_mutated": False,
                            "metadata_rows_mutated": False,
                        },
                        "approval_items": [
                            {"id": "ocr_vision_canary", "priority": "critical", "status": "degraded_provider_required", "ready_for_approval": True, "reason": "vision/OCR lane requires provider approval"},
                            {"id": "large_file_canary", "priority": "critical", "status": "approval_required", "ready_for_approval": True, "reason": "bounded extraction canary required"},
                            {"id": "archive_worker_image", "priority": "high", "status": "ready_for_operator_approval", "ready_for_approval": True, "reason": "Docker/CI access required"},
                            {"id": "search_index_population", "priority": "high", "status": "approval_required", "ready_for_approval": True, "reason": "search index canary required"},
                            {"id": "llm_review_campaign", "priority": "high", "status": "approval_required", "ready_for_approval": True, "reason": "sanitized LLM campaign required"},
                            {"id": "deferred_media_final_pass", "priority": "deferred", "status": "deferred", "ready_for_approval": False, "reason": "media deferred until final pass"},
                        ],
                        "sections": {
                            "extraction_readiness": {"status": "pending_completion"},
                            "tool_remediation": {
                                "present": True,
                                "status": "operator_remediation_required",
                                "summary": {"action_count": 6, "non_deferred_action_count": 5},
                                "actions": [
                                    {"id": "approve_large_file_runner_canary"},
                                    {"id": "enable_ocr_or_vision_lane"},
                                ],
                                "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
                            },
                            "archive_worker_image": {"approval": {"status": "ready_for_operator_approval"}},
                            "search_index_population": {"approval": {"status": "approval_required"}},
                            "llm_review_campaign": {"approval": {"approval_status": "approval_required"}},
                            "deferred_media": {"status": "deferred"},
                        },
                    }
                ),
                encoding="utf-8",
            )
            approval_request_packet.write_text(
                json.dumps(
                    {
                        "kind": "open_files_operator_approval_note_template_packet",
                        "status": "templates_ready",
                        "template_count": 5,
                        "source_status": {
                            "dashboard_status": "ready_for_operator_review",
                            "approval_notes_status": "missing_required",
                            "approved_required_decision_count": 0,
                            "remediation_status": "operator_remediation_required",
                            "remediation_action_count": 6,
                        },
                        "non_mutation_attestation": {
                            "templates_only": True,
                            "approvals_granted": False,
                            "execution_launched": False,
                            "corpus_bytes_mutated": False,
                            "s3_objects_mutated": False,
                            "metadata_rows_mutated": False,
                        },
                        "templates": [
                            {
                                "decision_id": "large_file_canary",
                                "priority": "critical",
                                "status": "approval_required",
                                "ready_for_approval": True,
                                "scope": "canary",
                                "template_sha256": "a" * 64,
                                "command_hashes": [{"name": "execute", "sha256": "b" * 64, "bytes": 10}],
                                "remediation_action_ids": ["approve_large_file_runner_canary"],
                                "remediation_status": "operator_remediation_required",
                                "sensitive_marker_counts": {},
                            }
                        ],
                        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
                    }
                ),
                encoding="utf-8",
            )
            approval_request_verification.write_text(
                json.dumps(
                    {
                        "kind": "open_files_operator_approval_request_packet_verification",
                        "status": "ok",
                        "packet_status": "templates_ready",
                        "template_count": 5,
                        "decision_ids": [
                            "ocr_vision_canary",
                            "large_file_canary",
                            "archive_worker_image",
                            "search_index_population",
                            "llm_review_campaign",
                        ],
                        "source_status": {
                            "dashboard_status": "ready_for_operator_review",
                            "approval_notes_status": "missing_required",
                            "approved_required_decision_count": 0,
                            "remediation_status": "operator_remediation_required",
                            "remediation_action_count": 6,
                        },
                        "gates": {
                            "kind_ok": True,
                            "status_templates_ready": True,
                            "redaction_ok": True,
                            "non_mutation_attested": True,
                            "source_status_ok": True,
                            "required_decisions_present": True,
                            "template_count_consistent": True,
                            "template_hashes_valid": True,
                            "template_files_present": True,
                            "command_hashes_valid": True,
                            "remediation_links_valid": True,
                        },
                        "errors": [],
                        "warnings": [],
                    }
                ),
                encoding="utf-8",
            )
            replacement_readiness.write_text(
                json.dumps(
                    {
                        "kind": "open_files_google_drive_replacement_readiness_gate",
                        "status": "blocked",
                        "approved_to_replace_google_drive": False,
                        "summary": {
                            "requirements": 9,
                            "complete": 2,
                            "blocked": 6,
                            "deferred": 1,
                            "missing": 0,
                            "first_incomplete_requirement": "read_extraction_coverage",
                        },
                        "requirements": [
                            {
                                "key": "active_file_mapping",
                                "title": "Every active file is inventoried and routed",
                                "status": "complete",
                                "complete": True,
                                "blockers": [],
                                "evidence": {"active_files": 12},
                            },
                            {
                                "key": "files_cli_search_index",
                                "title": "All active survivor files are indexed into fast files CLI search surfaces",
                                "status": "blocked",
                                "complete": False,
                                "blockers": [
                                    "search-index canary/full population and runtime attestation are incomplete"
                                ],
                                "evidence": {"remaining_jobs": 10},
                            },
                        ],
                        "redaction": "aggregate-only",
                    }
                ),
                encoding="utf-8",
            )

            proc = run_script(
                "--output-dir",
                str(output),
                "--search-index-packet",
                str(search_packet),
                "--search-index-validation",
                str(validation),
                "--search-index-runtime-summary",
                str(search_runtime),
                "--duplicate-preserve-attestation",
                str(duplicate_attestation),
                "--stage-dependency-gate",
                str(stage_dependency_gate),
                "--stage-dependency-verification",
                str(stage_dependency_verification),
                "--llm-campaign-plan",
                str(campaign),
                "--llm-campaign-runtime-summary",
                str(campaign_runtime),
                "--llm-provider-readiness",
                str(provider_readiness),
                "--llm-campaign-results-summary",
                str(campaign_results),
                "--deferred-media-summary",
                str(deferred_media),
                "--extraction-readiness-gate",
                str(extraction_readiness),
                "--extraction-readiness-verification",
                str(extraction_readiness_verification),
                "--extraction-worker-image-verification",
                str(worker_image),
                "--extraction-approval-dashboard",
                str(approval_dashboard),
                "--approval-request-packet",
                str(approval_request_packet),
                "--approval-request-verification",
                str(approval_request_verification),
                "--replacement-readiness-gate",
                str(replacement_readiness),
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            packet_text = (output / "adversarial-review-packet.json").read_text(encoding="utf-8")
            packet = json.loads(packet_text)
            self.assertEqual(packet["kind"], "open_files_adversarial_review_packet")
            self.assertIn("reviewer_a", packet["reviewers"])
            self.assertIn("reviewer_b", packet["reviewers"])
            self.assertEqual(packet["artifacts"]["stage_dependency_gate"]["status"], "blocked")
            self.assertFalse(packet["artifacts"]["stage_dependency_gate"]["approved_to_scale"])
            self.assertEqual(packet["artifacts"]["stage_dependency_gate"]["first_blocking_stage"], "extraction_lane_readiness")
            self.assertEqual(packet["artifacts"]["stage_dependency_gate"]["stages"][0]["key"], "duplicate_preserve_policy")
            self.assertEqual(packet["artifacts"]["stage_dependency_gate"]["stages"][1]["blockers"], ["pending extraction lanes remain"])
            self.assertEqual(packet["artifacts"]["stage_dependency_verification"]["status"], "ok")
            self.assertEqual(packet["artifacts"]["stage_dependency_verification"]["gate_status"], "blocked")
            self.assertTrue(packet["artifacts"]["stage_dependency_verification"]["gates"]["stage_order_complete_set"])
            self.assertEqual(packet["artifacts"]["stage_dependency_verification"]["source_artifacts"]["present"], 7)
            self.assertTrue(packet["artifacts"]["llm_campaign"]["worker_manifest_sanitized"])
            self.assertEqual(packet["artifacts"]["llm_campaign"]["redaction_attestation"]["status"], "ok")
            self.assertEqual(packet["artifacts"]["llm_campaign"]["approval_attestation"]["status"], "approval_required")
            self.assertEqual(packet["artifacts"]["llm_campaign"]["direct_provider_policy_attestation"]["job_identity_policy"], "synthetic-job-ref")
            self.assertFalse(packet["artifacts"]["llm_campaign"]["direct_provider_policy_attestation"]["real_file_ids_sent"])
            self.assertEqual(packet["artifacts"]["llm_campaign"]["schedule_policy"]["status"], "ok")
            self.assertEqual(packet["artifacts"]["llm_campaign"]["schedule_policy"]["max_campaign_parallel"], 1)
            self.assertEqual(packet["artifacts"]["llm_campaign_results"]["rename_correctness_gate"]["status"], "pending")
            self.assertEqual(packet["artifacts"]["llm_campaign_results"]["runtime_attestation_gate"]["status"], "pending")
            self.assertEqual(packet["artifacts"]["llm_campaign_results"]["scale_readiness_attestation"]["status"], "pending_canary")
            self.assertEqual(packet["artifacts"]["deferred_media_completion"]["status"], "deferred")
            self.assertTrue(packet["artifacts"]["deferred_media_completion"]["completion_gate"]["cannot_hide_behind_boolean_deferral"])
            self.assertEqual(packet["artifacts"]["extraction_readiness"]["status"], "pending_completion")
            self.assertTrue(packet["artifacts"]["extraction_readiness"]["gate"]["all_active_lanes_explicitly_routed"])
            self.assertFalse(packet["artifacts"]["extraction_readiness"]["gate"]["full_extraction_complete"])
            self.assertEqual(packet["artifacts"]["extraction_readiness"]["status_counts"]["deferred_media"], 2)
            self.assertEqual(packet["artifacts"]["extraction_readiness_verification"]["status"], "ok")
            self.assertEqual(packet["artifacts"]["extraction_readiness_verification"]["gate_status"], "pending_completion")
            self.assertTrue(packet["artifacts"]["extraction_readiness_verification"]["checks"]["semantic_projection_current"])
            self.assertTrue(packet["artifacts"]["extraction_readiness_verification"]["source_artifacts"]["current_checked"])
            self.assertEqual(packet["artifacts"]["extraction_worker_image"]["status"], "ok")
            self.assertEqual(packet["artifacts"]["extraction_worker_image"]["static_status"], "ok")
            self.assertEqual(packet["artifacts"]["extraction_worker_image"]["docker_status"], "permission_denied")
            self.assertIn("p7zip-full", packet["artifacts"]["extraction_worker_image"]["archive_tool_packages"])
            self.assertTrue(packet["artifacts"]["extraction_worker_image"]["redaction_checks"]["smoke_checks_hashed_names"])
            self.assertEqual(packet["artifacts"]["extraction_worker_image"]["worker_runtime_policy"]["network_mode"], "none")
            self.assertTrue(packet["artifacts"]["extraction_worker_image"]["worker_runtime_policy"]["network_disabled"])
            self.assertFalse(packet["artifacts"]["extraction_worker_image"]["worker_runtime_policy"]["s3_object_access_allowed"])
            self.assertEqual(packet["artifacts"]["extraction_approval_dashboard"]["status"], "ready_for_operator_review")
            self.assertEqual(packet["artifacts"]["extraction_approval_dashboard"]["overall"]["ready_approval_items"], 5)
            self.assertEqual(packet["artifacts"]["extraction_approval_dashboard"]["tool_remediation"]["status"], "operator_remediation_required")
            self.assertEqual(packet["artifacts"]["extraction_approval_dashboard"]["tool_remediation"]["summary"]["action_count"], 6)
            self.assertIn("enable_ocr_or_vision_lane", packet["artifacts"]["extraction_approval_dashboard"]["tool_remediation"]["action_ids"])
            self.assertEqual(packet["artifacts"]["extraction_approval_dashboard"]["overall"]["blocked_or_missing_prep_items"], [])
            self.assertFalse(packet["artifacts"]["extraction_approval_dashboard"]["overall"]["s3_objects_mutated"])
            self.assertEqual(packet["artifacts"]["extraction_approval_dashboard"]["section_statuses"]["archive_worker_image"], "ready_for_operator_approval")
            self.assertEqual(packet["artifacts"]["approval_request_packet"]["status"], "templates_ready")
            self.assertEqual(packet["artifacts"]["approval_request_packet"]["template_count"], 5)
            self.assertEqual(packet["artifacts"]["approval_request_packet"]["source_status"]["remediation_status"], "operator_remediation_required")
            self.assertEqual(packet["artifacts"]["approval_request_packet"]["templates"][0]["remediation_action_ids"], ["approve_large_file_runner_canary"])
            self.assertFalse(packet["artifacts"]["approval_request_packet"]["non_mutation_attestation"]["approvals_granted"])
            self.assertEqual(packet["artifacts"]["approval_request_verification"]["status"], "ok")
            self.assertEqual(packet["artifacts"]["approval_request_verification"]["packet_status"], "templates_ready")
            self.assertTrue(packet["artifacts"]["approval_request_verification"]["gates"]["template_hashes_valid"])
            self.assertEqual(packet["artifacts"]["replacement_readiness_gate"]["status"], "blocked")
            self.assertFalse(packet["artifacts"]["replacement_readiness_gate"]["approved_to_replace_google_drive"])
            self.assertEqual(
                packet["artifacts"]["replacement_readiness_gate"]["summary"]["first_incomplete_requirement"],
                "read_extraction_coverage",
            )
            self.assertEqual(packet["artifacts"]["replacement_readiness_gate"]["requirements"][1]["key"], "files_cli_search_index")
            self.assertEqual(packet["artifacts"]["llm_campaign"]["runtime_negative_execute"]["approval_attestation"]["status"], "blocked")
            self.assertEqual(packet["artifacts"]["llm_campaign"]["runtime_negative_execute"]["global_execution_preflight"]["status"], "canary_approval_token_required")
            self.assertFalse(packet["artifacts"]["llm_campaign"]["runtime_negative_execute"]["global_execution_preflight"]["allowed"])
            self.assertEqual(packet["artifacts"]["llm_provider_readiness"]["status"], "ok")
            self.assertEqual(packet["artifacts"]["llm_provider_readiness"]["direct_provider_policy_gate"]["status"], "ok")
            self.assertTrue(packet["artifacts"]["llm_provider_readiness"]["direct_provider_policy_gate"]["checks"]["raw_file_bytes_not_sent"])
            self.assertEqual(packet["artifacts"]["llm_provider_readiness"]["schedule_gate"]["invalid_account_count"], 0)
            self.assertFalse(packet["artifacts"]["llm_provider_readiness"]["non_mutation_attestation"]["provider_calls_made"])
            self.assertTrue(packet["artifacts"]["llm_provider_readiness"]["redaction_check"]["passed"])
            self.assertEqual(packet["artifacts"]["search_index"]["runtime_negative_execute"]["approval_attestation"]["status"], "blocked")
            self.assertEqual(packet["artifacts"]["search_index"]["runtime_negative_execute"]["global_execution_preflight"]["max_canary_jobs"], 1)
            self.assertEqual(packet["artifacts"]["search_index"]["runtime_negative_execute"]["global_execution_preflight"]["status"], "canary_approval_token_required")
            self.assertFalse(packet["artifacts"]["search_index"]["runtime_negative_execute"]["global_execution_preflight"]["allowed"])
            self.assertEqual(packet["artifacts"]["search_index"]["runtime_immutable_metadata"]["runtime_attestation"]["status"], "not_executed")
            self.assertEqual(packet["artifacts"]["search_index"]["search_probe_attestation"]["status"], "not_executed")
            self.assertEqual(packet["artifacts"]["search_index"]["search_probe_attestation"]["probes"], 0)
            self.assertEqual(packet["artifacts"]["search_index"]["scale_readiness_attestation"]["status"], "pending_canary")
            self.assertEqual(packet["artifacts"]["search_index"]["duplicate_preserve_policy"]["status"], "attested_with_pending_index")
            self.assertEqual(packet["artifacts"]["search_index"]["duplicate_preserve_policy"]["planner_reconciliation"]["exempt_duplicate_rows"], 2)
            self.assertEqual(packet["artifacts"]["search_index"]["duplicate_preserve_policy"]["organization_duplicates"]["groups_without_planned_or_indexed_survivor"], 0)
            self.assertFalse(packet["artifacts"]["search_index"]["duplicate_preserve_policy"]["scale_readiness"]["approved_to_scale"])
            self.assertEqual(packet["redaction_contract"]["output_sensitive_marker_counts"], {})

            generated = "\n".join(path.read_text(encoding="utf-8") for path in output.iterdir() if path.is_file())
            self.assertNotIn('"file_id"', generated)
            self.assertNotIn("open-files://", generated)
            self.assertNotIn("objects/sha256/", generated)
            self.assertNotIn("s3://", generated)
            self.assertIn("privacy/security/sandbox adversary", generated)
            self.assertIn("scalability/correctness/search adversary", generated)
            self.assertIn("Do not use tools, shell commands, web search, MCP, or filesystem access.", generated)
            self.assertTrue((output / "reviewer-a-input-attestation.json").exists())
            self.assertTrue((output / "reviewer-b-input-attestation.json").exists())
            self.assertTrue((output / "reviewer-a-direct-prompt.md").exists())
            self.assertTrue((output / "reviewer-b-direct-prompt.md").exists())
            attestation = json.loads((output / "reviewer-a-input-attestation.json").read_text(encoding="utf-8"))
            self.assertEqual(attestation["reviewer"], "reviewer_a")
            self.assertRegex(attestation["packet_sha256"], r"^[0-9a-f]{64}$")
            self.assertIn('"input_attestation"', (output / "reviewer-a-direct-prompt.md").read_text(encoding="utf-8"))

    def test_sensitive_source_artifact_is_blocked_without_echoing_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.json"
            output = root / "packet"
            source.write_text('{"file_id":"f_privateSecret123","status":"bad"}', encoding="utf-8")

            proc = run_script("--output-dir", str(output), "--search-index-packet", str(source))

            self.assertEqual(proc.returncode, 2)
            self.assertIn("json_file_id_key", proc.stderr)
            self.assertIn("private_file_id_value", proc.stderr)
            self.assertNotIn("f_privateSecret123", proc.stderr)
            self.assertFalse((output / "adversarial-review-packet.json").exists())

    def test_schema_requires_privacy_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "packet"
            proc = run_script("--output-dir", str(output))

            self.assertEqual(proc.returncode, 0, proc.stderr)
            schema = json.loads((output / "reviewer-final.schema.json").read_text(encoding="utf-8"))
            required = schema["properties"]["privacy_confirmation"]["required"]
            self.assertIn("reviewed_only_packet_files", required)
            self.assertIn("no_private_values_in_response", required)
            self.assertIn("no_file_content_requested", required)
            self.assertIn("input_attestation", schema["required"])
            attestation_required = schema["properties"]["input_attestation"]["required"]
            self.assertIn("packet_sha256", attestation_required)
            self.assertIn("schema_sha256", attestation_required)
            self.assertIn("reviewer_prompt_sha256", attestation_required)
            self.assertEqual(schema["properties"]["reviewer"]["enum"], ["reviewer_a", "reviewer_b"])


if __name__ == "__main__":
    unittest.main()
