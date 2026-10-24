import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from tts_mcp import desktop_diagnostics


class DesktopDiagnosticsTests(unittest.TestCase):
    def test_report_is_bounded_redacted_and_excludes_unapproved_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            for index in range(desktop_diagnostics.MAX_EVENTS + 5):
                desktop_diagnostics.record(
                    data_dir,
                    "request_failed",
                    operation="synthesize",
                    code="operation_failed",
                    message=f"failed at {Path.home()}/private/file",
                )
            report = desktop_diagnostics.report(
                data_dir,
                app_version="0.1.1",
                runtime={"active": False},
                frontend_complete=False,
                frontend_events=[
                    {
                        "time": datetime.now(timezone.utc).isoformat(),
                        "category": "frontend_error",
                        "code": "TypeError",
                        "message": f"failed at {Path.home()}/private/file",
                        "traceback": f'File "{Path.home()}/app/App.tsx", line 10',
                        "request_id": "web-3",
                        "provider": "vieneu",
                        "stage": "download",
                        "asset": f"{Path.home()}/models/vieneu",
                        "error_type": "TypeError",
                        "duration_ms": 42,
                        "request_payload": "private text",
                    }
                ],
            )

            frontend_event = next(
                event for event in report["events"] if event.get("request_id") == "web-3"
            )
            self.assertLessEqual(len(report["events"]), desktop_diagnostics.MAX_EVENTS)
            self.assertIn("~/private/file", report["events"][-1]["message"])
            self.assertEqual(frontend_event["provider"], "vieneu")
            self.assertEqual(frontend_event["duration_ms"], 42)
            self.assertIn("~/app/App.tsx", frontend_event["traceback"])
            self.assertIn("~/models/vieneu", frontend_event["asset"])
            self.assertNotIn("request_payload", json.dumps(report))
            self.assertNotIn("private text", json.dumps(report))
            self.assertNotIn(str(Path.home()), json.dumps(report))
            self.assertFalse(report["diagnostics_complete"])

    def test_report_includes_redacted_failed_request_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            desktop_diagnostics.clear(data_dir)
            home_path = str(Path.home())
            desktop_diagnostics.record(
                data_dir,
                "request_failed",
                operation="prepare_model",
                code="operation_failed",
                message=f"Could not load {home_path}/models/voice",
                traceback=f'File "{home_path}/app/desktop.py", line 42',
                request_id="27",
                provider="omnivoice",
                stage="download",
                asset=f"{home_path}/models/voice",
                error_type="RuntimeError",
                duration_ms=317,
            )

            report = desktop_diagnostics.report(
                data_dir,
                app_version="0.1.1",
                runtime={"state": "cpu"},
            )

            event = report["events"][-1]
            self.assertEqual(event["request_id"], "27")
            self.assertEqual(event["provider"], "omnivoice")
            self.assertEqual(event["stage"], "download")
            self.assertIn("~/models/voice", event["asset"])
            self.assertEqual(event["error_type"], "RuntimeError")
            self.assertIn("~/models/voice", event["message"])
            self.assertIn("~/app/desktop.py", event["traceback"])
            self.assertEqual(event["duration_ms"], 317)
            self.assertNotIn(home_path, json.dumps(report))

    def test_clear_removes_persisted_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            desktop_diagnostics.record(data_dir, "request_failed", code="failed")
            desktop_diagnostics.clear(data_dir)
            self.assertEqual(desktop_diagnostics.events(data_dir), [])

    def test_events_are_cached_until_the_file_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            desktop_diagnostics.record(data_dir, "runtime", message="first")
            with patch(
                "tts_mcp.desktop_diagnostics._load",
                wraps=desktop_diagnostics._load,
            ) as load:
                first = desktop_diagnostics.events(data_dir)
                second = desktop_diagnostics.events(data_dir)
            self.assertEqual(load.call_count, 1)
            self.assertEqual(first, second)

            desktop_diagnostics.record(data_dir, "runtime", message="second")
            self.assertEqual(len(desktop_diagnostics.events(data_dir)), 2)

    def test_report_filters_untrusted_persisted_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            desktop_diagnostics.clear(data_dir)
            data_dir.mkdir(exist_ok=True)
            (data_dir / "diagnostics.jsonl").write_text(
                json.dumps(
                    {
                        "time": "2026-10-19T00:00:00Z",
                        "category": "request_failed",
                        "message": {"text": "private payload"},
                        "request_payload": "private payload",
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            report = desktop_diagnostics.report(data_dir, app_version="0.1.1", runtime={})

            self.assertNotIn("private payload", json.dumps(report))
            self.assertNotIn("request_payload", json.dumps(report))
            self.assertFalse(report["diagnostics_complete"])
            desktop_diagnostics.clear(data_dir)

    def test_write_failure_is_reported_without_raising(self):
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.object(desktop_diagnostics, "_WRITE_FAILED", False),
        ):
            with patch.object(desktop_diagnostics.tempfile, "mkstemp", side_effect=OSError):
                desktop_diagnostics.record(Path(tmp), "request_failed")
            report = desktop_diagnostics.report(Path(tmp), app_version="0.1.1", runtime={})
            self.assertFalse(report["diagnostics_complete"])
            desktop_diagnostics.record(Path(tmp), "recovered")
            self.assertTrue(desktop_diagnostics.is_complete())


if __name__ == "__main__":
    unittest.main()
