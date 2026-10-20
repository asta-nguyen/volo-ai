import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tts_mcp import desktop_runtime as runtime


class FakeResponse:
    def __init__(self, body):
        self.body = body
        self.headers = {"Content-Length": str(len(body))}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, _size=-1):
        body, self.body = self.body, b""
        return body


def make_release(version="0.1.1", payload=b"cuda-runtime", part_hash=None):
    prefix = f"volo-ai_v{version}_linux_x64_cuda"
    digest = hashlib.sha256(payload).hexdigest()
    manifest = {
        "format": 1,
        "version": version,
        "target": runtime.TARGET,
        "payload": {"size": len(payload), "sha256": digest},
        "parts": [
            {
                "name": f"{prefix}.part-001",
                "size": len(payload),
                "sha256": part_hash or digest,
            }
        ],
    }
    return json.dumps(manifest).encode(), payload, manifest


class DesktopRuntimeTests(unittest.TestCase):
    def test_manifest_rejects_version_target_traversal_and_bad_sizes(self):
        _, _, manifest = make_release()
        for edit, message in (
            (lambda value: value.update(version="0.1.2"), "version or target"),
            (lambda value: value.update(target="linux-x64"), "version or target"),
            (lambda value: value["parts"][0].update(name="../runtime"), "part 1 is invalid"),
            (lambda value: value["parts"][0].update(size=True), "part 1 is invalid"),
        ):
            with self.subTest(message=message):
                invalid = json.loads(json.dumps(manifest))
                edit(invalid)
                with self.assertRaisesRegex(ValueError, message):
                    runtime._validate_manifest(invalid, "0.1.1")

    def test_install_verifies_payload_and_updates_state_atomically(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            manifest_body, payload, manifest = make_release(payload=b"valid-runtime")
            responses = [FakeResponse(manifest_body), FakeResponse(payload)]
            with (
                patch.object(runtime, "supported_platform", return_value=True),
                patch.object(runtime.urllib.request, "urlopen", side_effect=responses),
                patch.object(runtime.shutil, "disk_usage", return_value=Mock(free=10_000_000)),
            ):
                result = runtime.install(data_dir, "0.1.1", "request")

            self.assertEqual(result["version"], "0.1.1")
            status = runtime.status(data_dir, "0.1.1")
            self.assertTrue(status["installed"])
            state = json.loads((data_dir / "nvidia-runtime" / "current.json").read_text())
            runtime_path = data_dir / "nvidia-runtime" / f"{manifest['payload']['sha256']}.bin"
            self.assertEqual(runtime_path.read_bytes(), payload)
            self.assertEqual(state["sha256"], hashlib.sha256(payload).hexdigest())

    def test_bad_part_hash_keeps_previous_runtime_and_cleans_partial_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            old_body, old_payload, _ = make_release(payload=b"old-runtime")
            bad_body, bad_payload, _ = make_release(payload=b"new-runtime", part_hash="0" * 64)
            good_responses = [FakeResponse(old_body), FakeResponse(old_payload)]
            with (
                patch.object(runtime, "supported_platform", return_value=True),
                patch.object(runtime.urllib.request, "urlopen", side_effect=good_responses),
                patch.object(runtime.shutil, "disk_usage", return_value=Mock(free=10_000_000)),
            ):
                runtime.install(data_dir, "0.1.1", "first")
            state_path = data_dir / "nvidia-runtime" / "current.json"
            original_state = state_path.read_bytes()

            with (
                patch.object(runtime, "supported_platform", return_value=True),
                patch.object(
                    runtime.urllib.request,
                    "urlopen",
                    side_effect=[FakeResponse(bad_body), FakeResponse(bad_payload)],
                ),
                patch.object(runtime.shutil, "disk_usage", return_value=Mock(free=10_000_000)),
                self.assertRaisesRegex(ValueError, "checksum mismatch"),
            ):
                runtime.install(data_dir, "0.1.1", "update")

            self.assertEqual(state_path.read_bytes(), original_state)
            self.assertEqual(
                sorted(path.name for path in (data_dir / "nvidia-runtime").iterdir()),
                sorted(
                    [
                        f"{hashlib.sha256(old_payload).hexdigest()}.bin",
                        "current.json",
                    ]
                ),
            )

    def test_install_repairs_a_corrupted_content_addressed_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            manifest_body, payload, manifest = make_release(payload=b"valid-runtime")
            runtime_dir = data_dir / "nvidia-runtime"
            runtime_dir.mkdir()
            runtime_path = runtime_dir / f"{manifest['payload']['sha256']}.bin"
            runtime_path.write_bytes(b"bad-runtime!!")
            self.assertEqual(runtime_path.stat().st_size, len(payload))

            with (
                patch.object(runtime, "supported_platform", return_value=True),
                patch.object(
                    runtime.urllib.request,
                    "urlopen",
                    side_effect=[FakeResponse(manifest_body), FakeResponse(payload)],
                ),
                patch.object(runtime.shutil, "disk_usage", return_value=Mock(free=10_000_000)),
            ):
                runtime.install(data_dir, "0.1.1", "repair")

            self.assertEqual(runtime_path.read_bytes(), payload)

    def test_cancelled_download_cleans_partial_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            manifest_body, payload, _ = make_release()
            reads = 0

            def should_cancel():
                nonlocal reads
                reads += 1
                return reads > 1

            with (
                patch.object(runtime, "supported_platform", return_value=True),
                patch.object(
                    runtime.urllib.request,
                    "urlopen",
                    side_effect=[FakeResponse(manifest_body), FakeResponse(payload)],
                ),
                patch.object(runtime.shutil, "disk_usage", return_value=Mock(free=10_000_000)),
                self.assertRaises(runtime.RuntimeDownloadCancelled),
            ):
                runtime.install(data_dir, "0.1.1", "cancel", should_cancel=should_cancel)
            self.assertEqual(list((data_dir / "nvidia-runtime").iterdir()), [])

    def test_startup_falls_back_for_stale_or_unhealthy_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            manifest_body, payload, _ = make_release()
            with (
                patch.object(runtime, "supported_platform", return_value=True),
                patch.object(
                    runtime.urllib.request,
                    "urlopen",
                    side_effect=[FakeResponse(manifest_body), FakeResponse(payload)],
                ),
                patch.object(runtime.shutil, "disk_usage", return_value=Mock(free=10_000_000)),
            ):
                runtime.install(data_dir, "0.1.1", "install")

            selected, reason = runtime.select(data_dir, "0.1.2")
            self.assertIsNone(selected)
            self.assertIn("different app version", reason)
            with patch.object(
                runtime.subprocess,
                "run",
                return_value=Mock(returncode=1, stderr="CUDA runtime check failed: RuntimeError"),
            ):
                selected, reason = runtime.select(data_dir, "0.1.1")
            self.assertIsNone(selected)
            self.assertIn("CUDA runtime check failed", reason)
            with patch.object(runtime.subprocess, "run", return_value=Mock(returncode=0)):
                selected, reason = runtime.select(data_dir, "0.1.1")
            self.assertIsNotNone(selected)
            self.assertIsNone(reason)

    def test_missing_optional_runtime_is_normal_cpu_startup(self):
        with tempfile.TemporaryDirectory() as tmp:
            selected, reason = runtime.select(Path(tmp), "0.1.1")

        self.assertIsNone(selected)
        self.assertIsNone(reason)

    def test_remove_only_deletes_managed_runtime_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            runtime_dir = data_dir / "nvidia-runtime"
            runtime_dir.mkdir()
            (runtime_dir / "current.json").write_text("{}")
            (runtime_dir / ("a" * 64 + ".bin")).write_bytes(b"runtime")
            keep = runtime_dir / "unrelated.txt"
            keep.write_text("keep")
            output = data_dir / "outputs" / "generated.wav"
            output.parent.mkdir()
            output.write_bytes(b"audio")

            self.assertTrue(runtime.remove(data_dir))
            self.assertEqual([path.name for path in runtime_dir.iterdir()], ["unrelated.txt"])
            self.assertEqual(output.read_bytes(), b"audio")


if __name__ == "__main__":
    unittest.main()
