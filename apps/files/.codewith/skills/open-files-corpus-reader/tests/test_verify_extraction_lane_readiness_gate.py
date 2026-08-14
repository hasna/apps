#!/usr/bin/env python3
"""Tests for extraction lane readiness gate verification."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
BUILDER_SCRIPT = SCRIPT_DIR / "extraction_lane_readiness_gate.py"
VERIFIER_SCRIPT = SCRIPT_DIR / "verify_extraction_lane_readiness_gate.py"


def load_module(name: str, path: Path):
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def lane_rows() -> list[dict[str, int | str]]:
    return [
        {"key": "readable_now_text", "count": 10, "bytes": 100},
        {"key": "needs_pdf_extractor", "count": 20, "bytes": 200},
        {"key": "needs_office_extractor", "count": 30, "bytes": 300},
        {"key": "needs_ocr_or_vision", "count": 40, "bytes": 400},
        {"key": "needs_transcription", "count": 2, "bytes": 500},
        {"key": "needs_video_pipeline", "count": 3, "bytes": 600},
        {"key": "needs_archive_inventory", "count": 4, "bytes": 700},
        {"key": "needs_design_raw_pipeline", "count": 5, "bytes": 800},
        {"key": "metadata_only_or_unknown", "count": 6, "bytes": 900},
    ]


def corpus_map() -> dict:
    return {
        "totals": {"active_files": 120, "active_bytes": 4500},
        "aggregate": {
            "by_lane": lane_rows(),
            "by_lane_readiness": [
                {"key": "needs_pdf_extractor|large_file_runner_required", "count": 1, "bytes": 99},
            ],
        },
    }


def tool_inventory() -> dict:
    return {
        "lanes": {
            "readable_now_text": {"status": "ready", "provider_required": False},
            "needs_pdf_extractor": {"status": "ready", "provider_required": False},
            "needs_office_extractor": {"status": "ready", "provider_required": False},
            "needs_ocr_or_vision": {"status": "degraded", "provider_required": True, "missing_blocks": ["ocr"]},
            "needs_transcription": {"status": "deferred", "provider_required": True},
            "needs_video_pipeline": {"status": "deferred", "provider_required": True},
            "needs_archive_inventory": {"status": "ready", "provider_required": False},
            "needs_design_raw_pipeline": {"status": "degraded", "provider_required": True, "missing_blocks": ["preview"]},
            "metadata_only_or_unknown": {"status": "ready", "provider_required": False},
        },
    }


def smoke_summary() -> dict:
    by_lane = {}
    for lane in [
        "readable_now_text",
        "needs_pdf_extractor",
        "needs_office_extractor",
        "needs_ocr_or_vision",
        "needs_transcription",
        "needs_video_pipeline",
        "needs_archive_inventory",
        "needs_design_raw_pipeline",
        "metadata_only_or_unknown",
    ]:
        by_lane[lane] = {"samples": 2, "usable": 1, "routed": 2, "failed": 0, "not_implemented": 0, "skipped_size": 0}
    by_lane["needs_pdf_extractor"]["skipped_size"] = 1
    return {"by_lane": by_lane}


def deferred_media_summary() -> dict:
    return {
        "by_lane": [
            {"key": "needs_transcription", "count": 2, "bytes": 500},
            {"key": "needs_video_pipeline", "count": 3, "bytes": 600},
        ]
    }


class VerifyExtractionLaneReadinessGateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.builder = load_module("extraction_lane_readiness_gate", BUILDER_SCRIPT)
        self.verifier = load_module("verify_extraction_lane_readiness_gate", VERIFIER_SCRIPT)

    def write_sources(self, root: Path) -> dict[str, Path]:
        paths = {
            "corpus_map": root / "corpus-map-public.json",
            "tool_inventory": root / "extraction-tool-inventory.json",
            "worker_tool_inventory": root / "missing-worker-tool-inventory.json",
            "smoke_summary": root / "extraction-smoke-summary.json",
            "deferred_media_summary": root / "deferred-media-completion-summary.json",
        }
        paths["corpus_map"].write_text(json.dumps(corpus_map(), sort_keys=True), encoding="utf-8")
        paths["tool_inventory"].write_text(json.dumps(tool_inventory(), sort_keys=True), encoding="utf-8")
        paths["smoke_summary"].write_text(json.dumps(smoke_summary(), sort_keys=True), encoding="utf-8")
        paths["deferred_media_summary"].write_text(json.dumps(deferred_media_summary(), sort_keys=True), encoding="utf-8")
        return paths

    def build_gate_file(self, root: Path, source_paths: dict[str, Path]) -> Path:
        gate = self.builder.build_gate(
            corpus_map=json.loads(source_paths["corpus_map"].read_text()),
            tool_inventory=json.loads(source_paths["tool_inventory"].read_text()),
            smoke_summary=json.loads(source_paths["smoke_summary"].read_text()),
            deferred_media_summary=json.loads(source_paths["deferred_media_summary"].read_text()),
            sources=[
                self.builder.source_entry("corpus_map", source_paths["corpus_map"]),
                self.builder.source_entry("tool_inventory", source_paths["tool_inventory"]),
                self.builder.source_entry("worker_tool_inventory", source_paths["worker_tool_inventory"]),
                self.builder.source_entry("smoke_summary", source_paths["smoke_summary"]),
                self.builder.source_entry("deferred_media_summary", source_paths["deferred_media_summary"]),
            ],
        )
        gate_path = root / "extraction-lane-readiness-gate.json"
        gate_path.write_text(json.dumps(gate, indent=2, sort_keys=True), encoding="utf-8")
        return gate_path

    def test_valid_gate_verifies_current_sources(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = self.write_sources(root)
            gate_path = self.build_gate_file(root, source_paths)

            result = self.verifier.verify_gate(gate_path, source_paths=source_paths)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["gate_status"], "pending_completion")
        self.assertTrue(result["checks"]["semantic_projection_current"])
        self.assertEqual(result["source_artifacts"]["current_mismatched"], [])
        self.assertEqual(result["errors"], [])

    def test_current_source_hash_mismatch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = self.write_sources(root)
            gate_path = self.build_gate_file(root, source_paths)
            source_paths["smoke_summary"].write_text(json.dumps({"by_lane": {}}, sort_keys=True), encoding="utf-8")

            result = self.verifier.verify_gate(gate_path, source_paths=source_paths)

        self.assertEqual(result["status"], "error")
        self.assertIn("source_artifact_current_sha256_mismatch:smoke_summary", result["errors"])

    def test_semantic_projection_mismatch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = self.write_sources(root)
            gate_path = self.build_gate_file(root, source_paths)
            gate = json.loads(gate_path.read_text())
            gate["totals"]["sampled_files"] = 999
            gate_path.write_text(json.dumps(gate, indent=2, sort_keys=True), encoding="utf-8")

            result = self.verifier.verify_gate(gate_path, source_paths=source_paths)

        self.assertEqual(result["status"], "error")
        self.assertIn("totals_mismatch:sampled_files", result["errors"])
        self.assertIn("semantic_projection_mismatch", result["errors"])

    def test_sensitive_marker_fails_without_echoing_private_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = self.write_sources(root)
            gate_path = self.build_gate_file(root, source_paths)
            gate = json.loads(gate_path.read_text())
            gate["source_ref"] = "open-files://private-value"
            gate_path.write_text(json.dumps(gate, indent=2, sort_keys=True), encoding="utf-8")

            result = self.verifier.verify_gate(gate_path, source_paths=source_paths)

        self.assertEqual(result["status"], "error")
        self.assertIn("sensitive_marker_hits", result["errors"])
        self.assertNotIn("private-value", str(result))


if __name__ == "__main__":
    unittest.main()
