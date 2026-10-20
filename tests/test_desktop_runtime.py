import hashlib
import json
import tarfile
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock, patch

from tts_mcp import desktop_runtime as runtime


class FakeResponse:
    def __init__(self, body):
        self.body = body
        self.offset = 0
        self.headers = {"Content-Length": str(len(body))}
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def close(self):
        self.closed = True

    def read(self, size=-1):
        if size < 0:
            size = len(self.body) - self.offset
        end = min(self.offset + size, len(self.body))
        body = self.body[self.offset : end]
        self.offset = end
        return body


def default_members():
    return [
        ("runtime", "directory", b"", 0o755, ""),
        ("runtime/_internal", "directory", b"", 0o755, ""),
        ("runtime/tts-sidecar-cuda", "file", b"cuda executable", 0o755, ""),
        ("runtime/_internal/libtorch-real.so", "file", b"torch library", 0o644, ""),
        ("runtime/_internal/libtorch.so", "symlink", b"", 0o777, "libtorch-real.so"),
    ]


def build_archive(members):
    output = BytesIO()
    with tarfile.open(
        fileobj=output, mode="w:gz", format=tarfile.PAX_FORMAT, compresslevel=1
    ) as archive:
        for name, kind, body, mode, linkname in members:
            info = tarfile.TarInfo(name)
            info.mode = mode
            if kind == "directory":
                info.type = tarfile.DIRTYPE
            elif kind == "symlink":
                info.type = tarfile.SYMTYPE
                info.linkname = linkname
            elif kind == "hardlink":
                info.type = tarfile.LNKTYPE
                info.linkname = linkname
            elif kind == "fifo":
                info.type = tarfile.FIFOTYPE
            else:
                info.size = len(body)
            archive.addfile(info, BytesIO(body) if kind == "file" else None)
    return output.getvalue()


def make_release(version="0.1.1", members=None, part_hash=None, part_size=128, corrupt_gzip=False):
    members = default_members() if members is None else members
    payload = build_archive(members)
    if corrupt_gzip:
        payload = payload[:-1] + bytes([payload[-1] ^ 1])
    prefix = f"volo-ai_v{version}_linux_x64_cuda"
    parts = [payload[index : index + part_size] for index in range(0, len(payload), part_size)]
    manifest_parts = []
    for index, part in enumerate(parts, start=1):
        manifest_parts.append(
            {
                "name": f"{prefix}.part-{index:03d}",
                "size": len(part),
                "sha256": part_hash
                if part_hash and index == 1
                else hashlib.sha256(part).hexdigest(),
            }
        )
    manifest = {
        "format": 2,
        "version": version,
        "target": runtime.TARGET,
        "archive": {"size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()},
        "expanded_size": sum(
            len(body) for _name, kind, body, _mode, _link in members if kind == "file"
        ),
        "entrypoint": runtime.ENTRYPOINT,
        "parts": manifest_parts,
    }
    return json.dumps(manifest).encode(), parts, manifest, payload


class DesktopRuntimeTests(unittest.TestCase):
    def _install(
        self, data_dir, release, *, should_cancel=lambda: False, emit=None, free=1_000_000_000
    ):
        manifest_body, parts, _manifest, _payload = release
        responses = [FakeResponse(manifest_body), *(FakeResponse(part) for part in parts)]
        with (
            patch.object(runtime, "supported_platform", return_value=True),
            patch.object(runtime.urllib.request, "urlopen", side_effect=responses),
            patch.object(runtime.shutil, "disk_usage", return_value=Mock(free=free)) as disk_usage,
        ):
            result = runtime.install(
                data_dir, "0.1.1", "request", should_cancel=should_cancel, emit=emit
            )
        return result, disk_usage

    def test_manifest_rejects_version_target_paths_and_bad_sizes(self):
        _, _, manifest, _ = make_release()
        for edit, message in (
            (lambda value: value.update(version="0.1.2"), "version, target"),
            (lambda value: value.update(target="linux-x64"), "version, target"),
            (lambda value: value["parts"][0].update(name="../runtime"), "part 1 is invalid"),
            (lambda value: value["parts"][0].update(size=True), "part 1 is invalid"),
            (
                lambda value: value.update(expanded_size=runtime.MAX_PAYLOAD_SIZE + 1),
                "metadata is invalid",
            ),
        ):
            with self.subTest(message=message):
                invalid = json.loads(json.dumps(manifest))
                edit(invalid)
                with self.assertRaisesRegex(ValueError, message):
                    runtime._validate_manifest(invalid, "0.1.1")

    def test_install_streams_parts_extracts_tree_and_records_progress(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            release = make_release(part_size=64)
            events = []
            result, disk_usage = self._install(data_dir, release, emit=events.append)

            state_path = data_dir / "nvidia-runtime" / "current.json"
            state = json.loads(state_path.read_text())
            root = state_path.parent / state["sha256"]
            executable = root / "runtime" / "tts-sidecar-cuda"
            self.assertEqual(result, {"installed": True, "version": "0.1.1", "size": state["size"]})
            self.assertEqual(executable.read_bytes(), b"cuda executable")
            self.assertTrue(executable.stat().st_mode & 0o111)
            self.assertTrue((root / "runtime" / "_internal" / "libtorch.so").is_symlink())
            self.assertEqual(
                (root / "runtime" / "_internal" / "libtorch.so").readlink(),
                Path("libtorch-real.so"),
            )
            self.assertTrue(runtime.status(data_dir, "0.1.1")["installed"])
            self.assertEqual(disk_usage.call_args.args[0], data_dir / "nvidia-runtime")
            self.assertEqual(events[-1]["current"], events[-1]["total"])
            self.assertGreater(events[-1]["total"], release[2]["archive"]["size"])
            self.assertEqual(
                sorted(path.name for path in state_path.parent.iterdir()),
                sorted(["current.json", state["sha256"]]),
            )

    def test_bad_part_hash_preserves_previous_runtime_and_cleans_staging(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            self._install(data_dir, make_release())
            state_path = data_dir / "nvidia-runtime" / "current.json"
            original_state = state_path.read_bytes()
            bad_release = make_release(part_hash="0" * 64)
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                self._install(data_dir, bad_release)
            self.assertEqual(state_path.read_bytes(), original_state)
            self.assertFalse(
                any(path.name.startswith(".runtime-stage-") for path in state_path.parent.iterdir())
            )

    def test_archive_checksum_mismatch_keeps_previous_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            self._install(data_dir, make_release())
            state_path = data_dir / "nvidia-runtime" / "current.json"
            original_state = state_path.read_bytes()
            release = make_release()
            manifest_body, parts, manifest, payload = release
            manifest["archive"]["sha256"] = "0" * 64
            bad_release = (json.dumps(manifest).encode(), parts, manifest, payload)
            with self.assertRaisesRegex(ValueError, "archive checksum"):
                self._install(data_dir, bad_release)
            self.assertEqual(state_path.read_bytes(), original_state)

    def test_cancelled_download_and_extraction_remove_staging(self):
        for cancel_at in (2, 4):
            with self.subTest(cancel_at=cancel_at), tempfile.TemporaryDirectory() as tmp:
                data_dir = Path(tmp)
                reads = 0

                def should_cancel():
                    nonlocal reads
                    reads += 1
                    return reads >= cancel_at

                with self.assertRaises(runtime.RuntimeDownloadCancelled):
                    self._install(data_dir, make_release(), should_cancel=should_cancel)
                self.assertFalse((data_dir / "nvidia-runtime" / "current.json").exists())
                self.assertEqual(list((data_dir / "nvidia-runtime").iterdir()), [])

    def test_insufficient_disk_space_fails_before_runtime_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            release = make_release()
            manifest_body, _parts, _manifest, _payload = release
            with (
                patch.object(runtime, "supported_platform", return_value=True),
                patch.object(
                    runtime.urllib.request, "urlopen", return_value=FakeResponse(manifest_body)
                ) as urlopen,
                patch.object(runtime.shutil, "disk_usage", return_value=Mock(free=0)),
                self.assertRaisesRegex(RuntimeError, "Not enough free disk space"),
            ):
                runtime.install(data_dir, "0.1.1", "request")
            self.assertEqual(urlopen.call_count, 1)

    def test_rejects_traversal_duplicates_symlink_escape_and_nested_symlink(self):
        cases = [
            [*default_members(), ("runtime/../../outside", "file", b"x", 0o644, "")],
            [
                *default_members(),
                ("runtime/_internal/libtorch-real.so", "file", b"duplicate", 0o644, ""),
            ],
            [
                default_members()[0],
                default_members()[2],
                ("runtime/_internal", "symlink", b"", 0o777, "."),
                ("runtime/_internal/evil.so", "file", b"x", 0o644, ""),
            ],
            [
                *default_members()[:3],
                ("runtime/_internal/escape", "symlink", b"", 0o777, "../../../outside"),
            ],
        ]
        messages = (
            "escapes its runtime root",
            "duplicate member",
            "nested under a non-directory",
            "symlink escapes",
        )
        for members, message in zip(cases, messages, strict=True):
            with self.subTest(message=message), tempfile.TemporaryDirectory() as tmp:
                with self.assertRaisesRegex(ValueError, message):
                    self._install(Path(tmp), make_release(members=members))

    def test_rejects_hardlinks_special_files_and_missing_or_nonexecutable_entrypoint(self):
        cases = [
            (
                [
                    *default_members(),
                    (
                        "runtime/_internal/hardlink",
                        "hardlink",
                        b"",
                        0o644,
                        "runtime/tts-sidecar-cuda",
                    ),
                ],
                "unsupported member type",
            ),
            (
                [*default_members(), ("runtime/_internal/pipe", "fifo", b"", 0o644, "")],
                "unsupported member type",
            ),
            (
                [item for item in default_members() if item[0] != "runtime/tts-sidecar-cuda"],
                "missing its runtime root or executable",
            ),
            (
                [
                    (name, kind, body, 0o644 if name == runtime.ENTRYPOINT else mode, link)
                    for name, kind, body, mode, link in default_members()
                ],
                "entrypoint is not executable",
            ),
        ]
        for members, message in cases:
            with self.subTest(message=message), tempfile.TemporaryDirectory() as tmp:
                with self.assertRaisesRegex(ValueError, message):
                    self._install(Path(tmp), make_release(members=members))

    def test_expanded_size_mismatch_and_gzip_corruption_fail_cleanly(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            release = make_release()
            manifest_body, parts, manifest, payload = release
            manifest["expanded_size"] += 1
            with self.assertRaisesRegex(ValueError, "expanded size"):
                self._install(
                    data_dir,
                    (json.dumps(manifest).encode(), parts, manifest, payload),
                )
            self.assertEqual(list((data_dir / "nvidia-runtime").iterdir()), [])

        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "malformed or truncated"):
                self._install(Path(tmp), make_release(corrupt_gzip=True))

    def test_atomic_state_failure_preserves_previous_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            self._install(data_dir, make_release())
            runtime_dir = data_dir / "nvidia-runtime"
            state_path = runtime_dir / "current.json"
            old_state = state_path.read_bytes()
            altered = [
                (name, kind, body + b" new" if name == runtime.ENTRYPOINT else body, mode, link)
                for name, kind, body, mode, link in default_members()
            ]
            with patch.object(runtime, "_atomic_json", side_effect=OSError("disk error")):
                with self.assertRaisesRegex(RuntimeError, "download failed"):
                    self._install(data_dir, make_release(members=altered))
            self.assertEqual(state_path.read_bytes(), old_state)
            self.assertEqual(
                sorted(path.name for path in runtime_dir.iterdir()),
                sorted(["current.json", json.loads(old_state)["sha256"]]),
            )

    def test_startup_rehashes_runtime_and_falls_back_for_stale_or_unhealthy_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            self._install(data_dir, make_release())

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
            self.assertEqual(selected.name, "tts-sidecar-cuda")
            self.assertIsNone(reason)

            selected.parent.parent.joinpath("runtime", "_internal", "libtorch-real.so").write_bytes(
                b"tampered"
            )
            with patch.object(runtime.subprocess, "run") as run:
                selected, reason = runtime.select(data_dir, "0.1.1")
            self.assertIsNone(selected)
            self.assertIn("tree checksum", reason)
            run.assert_not_called()

    def test_legacy_runtime_is_not_selected_and_remove_only_deletes_managed_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            runtime_dir = data_dir / "nvidia-runtime"
            runtime_dir.mkdir()
            digest = hashlib.sha256(b"legacy").hexdigest()
            (runtime_dir / f"{digest}.bin").write_bytes(b"legacy")
            (runtime_dir / "current.json").write_text(
                json.dumps({"version": "0.1.1", "size": 6, "sha256": digest})
            )
            unrelated = runtime_dir / "unrelated.txt"
            unrelated.write_text("keep")
            audio = data_dir / "outputs" / "generated.wav"
            audio.parent.mkdir()
            audio.write_bytes(b"audio")

            selected, reason = runtime.select(data_dir, "0.1.1")
            self.assertIsNone(selected)
            self.assertIn("metadata or payload", reason)
            self.assertTrue(runtime.remove(data_dir))
            self.assertEqual([path.name for path in runtime_dir.iterdir()], ["unrelated.txt"])
            self.assertEqual(audio.read_bytes(), b"audio")

    def test_missing_runtime_is_normal_cpu_startup(self):
        with tempfile.TemporaryDirectory() as tmp:
            selected, reason = runtime.select(Path(tmp), "0.1.1")
        self.assertIsNone(selected)
        self.assertIsNone(reason)


if __name__ == "__main__":
    unittest.main()
