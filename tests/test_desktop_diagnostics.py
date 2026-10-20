import json
import tempfile
import unittest
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
                        "time": "2026-10-19T00:00:00Z",
                        "category": "frontend_error",
                        "code": "TypeError",
                        "message": f"failed at {Path.home()}/private/file",
                        "request_payload": "private text",
                    }
                ],
            )

            self.assertLessEqual(len(report["events"]), desktop_diagnostics.MAX_EVENTS)
            self.assertIn("~/private/file", report["events"][-1]["message"])
            self.assertNotIn("request_payload", json.dumps(report))
            self.assertNotIn("private text", json.dumps(report))
            self.assertNotIn(str(Path.home()), json.dumps(report))
            self.assertFalse(report["diagnostics_complete"])

    def test_clear_removes_persisted_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            desktop_diagnostics.record(data_dir, "request_failed", code="failed")
            desktop_diagnostics.clear(data_dir)
            self.assertEqual(desktop_diagnostics.events(data_dir), [])

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
