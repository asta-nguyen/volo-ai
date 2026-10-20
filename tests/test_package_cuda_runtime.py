import json
import tempfile
import unittest
from pathlib import Path

from scripts.package_cuda_runtime import split_payload, verify_cuda_assets, verify_release_assets


class PackageCudaRuntimeTests(unittest.TestCase):
    def test_split_manifest_and_release_assets_verify(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = root / "sidecar"
            payload.write_bytes(b"abcdefghi")
            assets = root / "assets"
            split_payload(payload, assets, "0.1.1", max_part_size=4)
            for name, content in (
                ("volo-ai_v0.1.1_macos_arm64.dmg", b"mac"),
                ("volo-ai_v0.1.1_windows_x64.msi", b"win"),
                ("volo-ai_v0.1.1_linux_x64.deb", b"deb"),
                ("volo-ai_v0.1.1_linux_x64.rpm", b"rpm"),
                ("volo-ai_v0.1.1_linux_x64.appimage", b"appimage"),
            ):
                (assets / name).write_bytes(content)

            verified = verify_release_assets(assets, "0.1.1")
            self.assertEqual(len(verified), 9)
            cuda_assets = root / "cuda-assets"
            cuda_assets.mkdir()
            for path in assets.glob("volo-ai_v0.1.1_linux_x64_cuda*"):
                path.rename(cuda_assets / path.name)
            self.assertEqual(len(verify_cuda_assets(cuda_assets, "0.1.1")), 4)

    def test_manifest_rejects_traversal_version_or_checksum_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = root / "sidecar"
            payload.write_bytes(b"runtime")
            assets = root / "assets"
            manifest_path = split_payload(payload, assets, "0.1.1")
            manifest = json.loads(manifest_path.read_text())

            manifest["parts"][0]["name"] = "../runtime"
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "part metadata"):
                verify_cuda_assets(assets, "0.1.1")

            split_payload(payload, assets, "0.1.1")
            (assets / "volo-ai_v0.1.2_linux_x64_cuda.json").write_text(manifest_path.read_text())
            with self.assertRaisesRegex(ValueError, "version or target"):
                verify_cuda_assets(assets, "0.1.2")

            manifest = json.loads(manifest_path.read_text())
            (assets / manifest["parts"][0]["name"]).write_bytes(b"xuntime")
            manifest_path = assets / "volo-ai_v0.1.1_linux_x64_cuda.json"
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                verify_cuda_assets(assets, "0.1.1")

    def test_release_verifier_requires_all_installer_targets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = root / "sidecar"
            payload.write_bytes(b"runtime")
            assets = root / "assets"
            split_payload(payload, assets, "0.1.1")
            (assets / "volo-ai_v0.1.1_linux_x64.deb").write_bytes(b"deb")
            with self.assertRaisesRegex(ValueError, "Missing installer targets"):
                verify_release_assets(assets, "0.1.1")


if __name__ == "__main__":
    unittest.main()
