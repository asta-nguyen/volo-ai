import hashlib
import json
import tarfile
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from scripts.package_cuda_runtime import (
    ENTRYPOINT,
    TARGET,
    split_payload,
    verify_cuda_assets,
    verify_release_assets,
)


def make_payload(root: Path) -> Path:
    root.mkdir()
    executable = root / "tts-sidecar-cuda"
    executable.write_bytes(b"cuda executable")
    executable.chmod(0o755)
    internal = root / "_internal"
    internal.mkdir()
    (internal / "libtorch.so").write_bytes(b"cuda library")
    return root


def unsafe_archive() -> bytes:
    output = BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz", format=tarfile.PAX_FORMAT) as archive:
        root = tarfile.TarInfo("runtime")
        root.type = tarfile.DIRTYPE
        archive.addfile(root)
        executable = tarfile.TarInfo(ENTRYPOINT)
        executable.mode = 0o755
        executable.size = 1
        archive.addfile(executable, BytesIO(b"x"))
        escape = tarfile.TarInfo("runtime/../../outside")
        escape.size = 1
        archive.addfile(escape, BytesIO(b"x"))
    return output.getvalue()


def write_archive_assets(archive: bytes, assets: Path, *, expanded_size: int) -> Path:
    version = "0.1.1"
    prefix = f"volo-ai_v{version}_linux_x64_cuda"
    assets.mkdir()
    parts = []
    for index in range(0, len(archive), 64):
        data = archive[index : index + 64]
        name = f"{prefix}.part-{len(parts) + 1:03d}"
        (assets / name).write_bytes(data)
        parts.append({"name": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    manifest = {
        "format": 2,
        "version": version,
        "target": TARGET,
        "archive": {"size": len(archive), "sha256": hashlib.sha256(archive).hexdigest()},
        "expanded_size": expanded_size,
        "entrypoint": ENTRYPOINT,
        "parts": parts,
    }
    manifest_path = assets / f"{prefix}.json"
    manifest_path.write_text(json.dumps(manifest))
    return manifest_path


class PackageCudaRuntimeTests(unittest.TestCase):
    def test_split_manifest_and_release_assets_verify(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = root / "assets"
            manifest_path = split_payload(
                make_payload(root / "sidecar"), assets, "0.1.1", max_part_size=64
            )
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(manifest["format"], 2)
            self.assertEqual(manifest["entrypoint"], ENTRYPOINT)
            self.assertGreater(len(manifest["parts"]), 1)
            self.assertEqual(
                manifest["expanded_size"], len(b"cuda executable") + len(b"cuda library")
            )
            for name, content in (
                ("volo-ai_v0.1.1_macos_arm64.dmg", b"mac"),
                ("volo-ai_v0.1.1_windows_x64.msi", b"win"),
                ("volo-ai_v0.1.1_linux_x64.deb", b"deb"),
                ("volo-ai_v0.1.1_linux_x64.rpm", b"rpm"),
                ("volo-ai_v0.1.1_linux_x64.appimage", b"appimage"),
            ):
                (assets / name).write_bytes(content)

            verified = verify_release_assets(assets, "0.1.1")
            self.assertEqual(len(verified), 6 + len(manifest["parts"]))
            cuda_assets = root / "cuda-assets"
            cuda_assets.mkdir()
            for path in assets.glob("volo-ai_v0.1.1_linux_x64_cuda*"):
                path.rename(cuda_assets / path.name)
            self.assertEqual(
                len(verify_cuda_assets(cuda_assets, "0.1.1")), 1 + len(manifest["parts"])
            )

    def test_manifest_rejects_wrong_version_or_part_checksum(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = root / "assets"
            manifest_path = split_payload(make_payload(root / "sidecar"), assets, "0.1.1")
            manifest = json.loads(manifest_path.read_text())
            manifest["parts"][0]["name"] = "../runtime"
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "part metadata"):
                verify_cuda_assets(assets, "0.1.1")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = root / "assets"
            manifest_path = split_payload(make_payload(root / "sidecar"), assets, "0.1.1")
            (assets / "volo-ai_v0.1.2_linux_x64_cuda.json").write_text(manifest_path.read_text())
            with self.assertRaisesRegex(ValueError, "version, target"):
                verify_cuda_assets(assets, "0.1.2")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = root / "assets"
            manifest_path = split_payload(make_payload(root / "sidecar"), assets, "0.1.1")
            manifest = json.loads(manifest_path.read_text())
            part = manifest["parts"][0]
            (assets / part["name"]).write_bytes(b"x" * part["size"])
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                verify_cuda_assets(assets, "0.1.1")

    def test_archive_verifier_rejects_traversal_and_oversized_expansion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_archive_assets(unsafe_archive(), root / "unsafe", expanded_size=2)
            with self.assertRaisesRegex(ValueError, "escapes its runtime root"):
                verify_cuda_assets(manifest.parent, "0.1.1")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_path = split_payload(make_payload(root / "sidecar"), root / "assets", "0.1.1")
            manifest = json.loads(manifest_path.read_text())
            manifest["expanded_size"] += 1
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "expanded size"):
                verify_cuda_assets(manifest_path.parent, "0.1.1")

    def test_payload_rejects_escaping_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = make_payload(root / "sidecar")
            (payload / "outside-link").symlink_to("../../outside")
            with self.assertRaisesRegex(ValueError, "symlink escapes"):
                split_payload(payload, root / "assets", "0.1.1")

    def test_release_verifier_requires_all_installer_targets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = root / "assets"
            split_payload(make_payload(root / "sidecar"), assets, "0.1.1")
            (assets / "volo-ai_v0.1.1_linux_x64.deb").write_bytes(b"deb")
            with self.assertRaisesRegex(ValueError, "Missing installer targets"):
                verify_release_assets(assets, "0.1.1")


if __name__ == "__main__":
    unittest.main()
