#!/usr/bin/env python3
"""Offline tests for aggregate extraction lane readiness gates."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "extraction_lane_readiness_gate.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("extraction_lane_readiness_gate", SCRIPT)
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


def base_corpus_map() -> dict:
    return {
        "totals": {"active_files": 120, "active_bytes": 4500},
        "aggregate": {
            "by_lane": lane_rows(),
            "by_lane_readiness": [
                {"key": "needs_pdf_extractor|large_file_runner_required", "count": 1, "bytes": 99},
                {"key": "needs_video_pipeline|large_file_runner_required", "count": 2, "bytes": 199},
            ],
        },
    }


def base_tool_inventory() -> dict:
    return {
        "lanes": {
            "readable_now_text": {"status": "ready", "provider_required": False},
            "needs_pdf_extractor": {"status": "ready", "provider_required": False},
            "needs_office_extractor": {"status": "ready", "provider_required": False},
            "needs_ocr_or_vision": {"status": "degraded", "provider_required": True, "missing_blocks": ["ocr"]},
            "needs_transcription": {"status": "deferred", "provider_required": True, "deferred": True},
            "needs_video_pipeline": {"status": "deferred", "provider_required": True, "deferred": True},
            "needs_archive_inventory": {"status": "ready", "provider_required": False},
            "needs_design_raw_pipeline": {"status": "degraded", "provider_required": True, "missing_blocks": ["preview"]},
            "metadata_only_or_unknown": {"status": "ready", "provider_required": False},
        },
    }


def base_smoke_summary() -> dict:
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
        by_lane[lane] = {
            "samples": 2,
            "usable": 1,
            "routed": 2,
            "failed": 0,
            "not_implemented": 0,
            "skipped_size": 0,
        }
    by_lane["needs_pdf_extractor"]["skipped_size"] = 1
    by_lane["needs_video_pipeline"]["skipped_size"] = 1
    return {
        "by_lane": by_lane,
        "results": [
            {"file_id": "f_privateDoNotLeak123", "extraction": {"summary": "private content should be ignored"}}
        ],
    }


class ExtractionLaneReadinessGateTests(unittest.TestCase):
    def test_gate_separates_ready_pending_deferred_and_large_file_routes(self) -> None:
        gate_module = load_module()
        gate = gate_module.build_gate(
            corpus_map=base_corpus_map(),
            tool_inventory=base_tool_inventory(),
            smoke_summary=base_smoke_summary(),
            deferred_media_summary={
                "by_lane": [
                    {"key": "needs_transcription", "count": 2, "bytes": 500},
                    {"key": "needs_video_pipeline", "count": 3, "bytes": 600},
                ]
            },
            sources=[],
        )
        by_lane = {lane["lane"]: lane for lane in gate["lanes"]}

        self.assertEqual(gate["status"], "pending_completion")
        self.assertTrue(gate["gate"]["all_active_lanes_explicitly_routed"])
        self.assertFalse(gate["gate"]["full_extraction_complete"])
        self.assertTrue(gate["gate"]["requires_operator_approval_before_scale"])
        self.assertTrue(gate["gate"]["requires_provider_or_tool_work"])
        self.assertTrue(gate["gate"]["final_media_pass_required"])
        self.assertEqual(by_lane["needs_pdf_extractor"]["route_status"], "approval_required_large_file_runner")
        self.assertEqual(by_lane["needs_ocr_or_vision"]["route_status"], "degraded_provider_required")
        self.assertEqual(by_lane["needs_transcription"]["route_status"], "deferred_media")
        self.assertIn("approved_large_file_runner_canary", by_lane["needs_pdf_extractor"]["requirements"])
        self.assertIn("approve_or_install_ocr_vision_lane", by_lane["needs_ocr_or_vision"]["requirements"])

    def test_gate_blocks_unknown_or_unimplemented_routes(self) -> None:
        gate_module = load_module()
        smoke = base_smoke_summary()
        smoke["by_lane"]["needs_archive_inventory"]["not_implemented"] = 1
        gate = gate_module.build_gate(
            corpus_map=base_corpus_map(),
            tool_inventory=base_tool_inventory(),
            smoke_summary=smoke,
            deferred_media_summary=None,
            sources=[],
        )

        self.assertEqual(gate["status"], "blocked")
        self.assertIn("needs_archive_inventory", gate["gate"]["hard_blocker_lanes"])
        self.assertFalse(gate["gate"]["cannot_hide_unknown_or_unimplemented_lanes"])

    def test_gate_blocks_routed_samples_with_no_usable_output(self) -> None:
        gate_module = load_module()
        smoke = base_smoke_summary()
        smoke["by_lane"]["metadata_only_or_unknown"]["usable"] = 0
        gate = gate_module.build_gate(
            corpus_map=base_corpus_map(),
            tool_inventory=base_tool_inventory(),
            smoke_summary=smoke,
            deferred_media_summary=None,
            sources=[],
        )
        by_lane = {lane["lane"]: lane for lane in gate["lanes"]}
        lane = by_lane["metadata_only_or_unknown"]

        self.assertEqual(gate["status"], "blocked")
        self.assertEqual(lane["route_status"], "sampled_no_usable_output")
        self.assertIn("metadata_only_or_unknown", gate["gate"]["hard_blocker_lanes"])
        self.assertIn("metadata_only_or_unknown", gate["gate"]["sampled_no_usable_lanes"])
        self.assertEqual(gate["totals"]["sampled_no_usable_lanes"], 1)
        self.assertFalse(gate["gate"]["all_sampled_non_deferred_non_approval_lanes_have_usable_output"])
        self.assertIn("fix_extraction_route_or_produce_usable_artifact", lane["requirements"])

    def test_gate_prefers_worker_inventory_when_it_clears_archive_missing_blocks(self) -> None:
        gate_module = load_module()
        host_tools = base_tool_inventory()
        host_tools["lanes"]["needs_archive_inventory"] = {
            "status": "ready",
            "provider_required": False,
            "missing_blocks": ["7z_inventory", "rar_inventory"],
        }
        worker_tools = base_tool_inventory()
        worker_tools["lanes"]["needs_archive_inventory"] = {
            "status": "ready",
            "provider_required": False,
            "missing_blocks": [],
        }

        gate = gate_module.build_gate(
            corpus_map=base_corpus_map(),
            tool_inventory=host_tools,
            smoke_summary=base_smoke_summary(),
            deferred_media_summary=None,
            sources=[],
            worker_tool_inventory=worker_tools,
        )
        archive = {lane["lane"]: lane for lane in gate["lanes"]}["needs_archive_inventory"]

        self.assertEqual(archive["route_status"], "ready")
        self.assertEqual(archive["tool_inventory_source"], "worker")
        self.assertEqual(archive["host_missing_blocks"], ["7z_inventory", "rar_inventory"])
        self.assertEqual(archive["worker_missing_blocks"], [])
        self.assertEqual(archive["requirements"], [])

    def test_gate_keeps_host_inventory_when_worker_inventory_is_worse(self) -> None:
        gate_module = load_module()
        host_tools = base_tool_inventory()
        host_tools["lanes"]["needs_archive_inventory"] = {
            "status": "ready",
            "provider_required": False,
            "missing_blocks": [],
        }
        worker_tools = base_tool_inventory()
        worker_tools["lanes"]["needs_archive_inventory"] = {
            "status": "tool_required",
            "provider_required": False,
            "missing_blocks": ["7z_inventory", "rar_inventory"],
        }

        gate = gate_module.build_gate(
            corpus_map=base_corpus_map(),
            tool_inventory=host_tools,
            smoke_summary=base_smoke_summary(),
            deferred_media_summary=None,
            sources=[],
            worker_tool_inventory=worker_tools,
        )
        archive = {lane["lane"]: lane for lane in gate["lanes"]}["needs_archive_inventory"]

        self.assertEqual(archive["route_status"], "ready")
        self.assertEqual(archive["tool_inventory_source"], "host")
        self.assertEqual(archive["host_missing_blocks"], [])
        self.assertEqual(archive["worker_missing_blocks"], ["7z_inventory", "rar_inventory"])

    def test_cli_output_is_aggregate_only_even_when_smoke_has_private_results(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus = root / "corpus.json"
            tools = root / "tools.json"
            smoke = root / "smoke.json"
            media = root / "media.json"
            output = root / "gate.json"
            corpus.write_text(json.dumps(base_corpus_map()), encoding="utf-8")
            tools.write_text(json.dumps(base_tool_inventory()), encoding="utf-8")
            smoke.write_text(json.dumps(base_smoke_summary()), encoding="utf-8")
            media.write_text(json.dumps({"by_lane": [{"key": "needs_video_pipeline", "count": 3, "bytes": 600}]}), encoding="utf-8")

            proc = run_script(
                "--corpus-map",
                str(corpus),
                "--tool-inventory",
                str(tools),
                "--smoke-summary",
                str(smoke),
                "--deferred-media-summary",
                str(media),
                "--output",
                str(output),
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            generated = proc.stdout + output.read_text(encoding="utf-8")
            self.assertNotIn("f_privateDoNotLeak123", generated)
            self.assertNotIn('"file_id"', generated)
            self.assertNotIn("private content", generated)
            self.assertIn("open_files_extraction_lane_readiness_gate", generated)


if __name__ == "__main__":
    unittest.main()
