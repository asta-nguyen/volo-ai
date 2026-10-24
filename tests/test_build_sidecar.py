import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_sidecar


class SidecarBuildTests(unittest.TestCase):
    def test_preflight_flags_vieneu_outside_declared_specifier(self):
        with (
            patch.object(
                build_sidecar.importlib.metadata,
                "requires",
                return_value=['vieneu<4,>=3.8.3 ; extra == "desktop-vieneu"'],
            ),
            patch.object(
                build_sidecar.importlib.metadata, "version", return_value="2.5.0"
            ) as version,
        ):
            problems = build_sidecar._check_build_environment()
            self.assertEqual(version.call_args.args[0], "vieneu")
            self.assertEqual(len(problems), 1)
            self.assertIn("vieneu", problems[0])
            self.assertIn("2.5.0", problems[0])

        with (
            patch.object(
                build_sidecar.importlib.metadata,
                "requires",
                return_value=['vieneu<4,>=3.8.3 ; extra == "desktop-vieneu"'],
            ),
            patch.object(build_sidecar.importlib.metadata, "version", return_value="3.8.3"),
        ):
            self.assertEqual(build_sidecar._check_build_environment(), [])

    def test_preflight_requires_installed_project(self):
        with patch.object(
            build_sidecar.importlib.metadata,
            "requires",
            side_effect=build_sidecar.importlib.metadata.PackageNotFoundError,
        ):
            self.assertEqual(
                build_sidecar._check_build_environment(),
                ["tts-mcp is not installed in this environment"],
            )

    def test_builder_aborts_when_environment_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(
                    build_sidecar,
                    "_check_build_environment",
                    return_value=["vieneu 2.5.0 does not satisfy vieneu<4,>=3.8.3"],
                ),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    ["build_sidecar.py", "--ffmpeg", str(ffmpeg)],
                ),
            ):
                with self.assertRaises(SystemExit) as raised:
                    build_sidecar.main()
            self.assertEqual(raised.exception.code, 2)
            run.assert_not_called()

    def test_builder_rejects_chocolatey_shim_ffmpeg(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            shim_dir = root / "chocolatey" / "bin"
            shim_dir.mkdir(parents=True)
            ffmpeg = shim_dir / "ffmpeg.exe"
            ffmpeg.write_bytes(b"shim")

            with (
                patch.dict(
                    build_sidecar.os.environ,
                    {"ChocolateyInstall": str(root / "chocolatey")},
                ),
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    ["build_sidecar.py", "--ffmpeg", str(ffmpeg)],
                ),
            ):
                with self.assertRaises(SystemExit) as raised:
                    build_sidecar.main()
            self.assertEqual(raised.exception.code, 2)
            run.assert_not_called()

    def test_builder_accepts_ffmpeg_under_chocolatey_tools(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            tools_dir = root / "chocolatey" / "lib" / "ffmpeg" / "tools" / "pkg" / "bin"
            tools_dir.mkdir(parents=True)
            ffmpeg = tools_dir / "ffmpeg.exe"
            ffmpeg.write_bytes(b"ffmpeg")
            onedir = root / "build" / "sidecar-dist" / "tts-sidecar" / "tts-sidecar"
            (onedir / "_internal").mkdir(parents=True)
            (onedir / "tts-sidecar.exe").write_bytes(b"sidecar")

            with (
                patch.dict(
                    build_sidecar.os.environ,
                    {"ChocolateyInstall": str(root / "chocolatey")},
                ),
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "SIDECAR_DIR", root / "sidecar"),
                patch.object(
                    build_sidecar, "host_triple", return_value="x86_64-pc-windows-msvc"
                ),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    ["build_sidecar.py", "--ffmpeg", str(ffmpeg)],
                ),
            ):
                build_sidecar.main()
            run.assert_called_once()

    def test_builder_stages_onedir_with_audiocpp_inside_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            audiocpp = root / "audiocpp_cli"
            audiocpp.write_bytes(b"audio.cpp")
            onedir = root / "build" / "sidecar-dist" / "tts-sidecar" / "tts-sidecar"
            (onedir / "_internal").mkdir(parents=True)
            (onedir / "tts-sidecar").write_bytes(b"sidecar")
            (onedir / "_internal" / "lib.bin").write_bytes(b"library")

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "SIDECAR_DIR", root / "sidecar"),
                patch.object(
                    build_sidecar, "host_triple", return_value="x86_64-unknown-linux-gnu"
                ),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(
                    build_sidecar, "_stage_linux_ffmpeg", return_value=[]
                ) as stage,
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--audiocpp",
                        str(audiocpp),
                    ],
                ),
            ):
                build_sidecar.main()

            stage.assert_called_once_with(
                ffmpeg.resolve(), root / "build" / "ffmpeg-linux"
            )
            command = run.call_args.args[0]
            collected = [
                command[index + 1]
                for index, value in enumerate(command[:-1])
                if value == "--collect-all"
            ]
            self.assertEqual(
                collected,
                ["omnivoice", "vieneu", "vieneu_utils", "sea_g2p", "onnxruntime", "yt_dlp"],
            )
            self.assertIn("--onedir", command)
            self.assertNotIn("--onefile", command)
            self.assertNotIn("--add-binary", command)
            self.assertNotIn(f"{ffmpeg.resolve()}:.", command)
            staged = root / "sidecar" / "tts-sidecar"
            self.assertEqual((staged / "tts-sidecar").read_bytes(), b"sidecar")
            self.assertEqual((staged / "_internal" / "lib.bin").read_bytes(), b"library")
            self.assertEqual(
                (staged / "audiocpp-cli-x86_64-unknown-linux-gnu").read_bytes(), b"audio.cpp"
            )

    def test_builder_names_windows_executables(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            audiocpp = root / "audiocpp_cli.exe"
            audiocpp.write_bytes(b"audio.cpp")
            onedir = root / "build" / "sidecar-dist" / "tts-sidecar" / "tts-sidecar"
            (onedir / "_internal").mkdir(parents=True)
            (onedir / "tts-sidecar.exe").write_bytes(b"sidecar")

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "SIDECAR_DIR", root / "sidecar"),
                patch.object(build_sidecar, "host_triple", return_value="x86_64-pc-windows-msvc"),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar.subprocess, "run"),
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--audiocpp",
                        str(audiocpp),
                        "--target",
                        "x86_64-pc-windows-msvc",
                    ],
                ),
            ):
                build_sidecar.main()

            staged = root / "sidecar" / "tts-sidecar"
            self.assertEqual((staged / "tts-sidecar.exe").read_bytes(), b"sidecar")
            self.assertEqual(
                (staged / "audiocpp-cli-x86_64-pc-windows-msvc.exe").read_bytes(),
                b"audio.cpp",
            )

    def test_builder_rejects_windows_target_on_non_windows_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(
                    build_sidecar, "host_triple", return_value="aarch64-apple-darwin"
                ),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--target",
                        "x86_64-pc-windows-msvc",
                    ],
                ),
            ):
                with self.assertRaises(SystemExit) as raised:
                    build_sidecar.main()
            self.assertEqual(raised.exception.code, 2)
            run.assert_not_called()

    def test_builder_rejects_non_x64_windows_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg.exe"
            ffmpeg.write_bytes(b"ffmpeg")

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(
                    build_sidecar, "host_triple", return_value="i686-pc-windows-msvc"
                ),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--target",
                        "i686-pc-windows-msvc",
                    ],
                ),
            ):
                with self.assertRaises(SystemExit) as raised:
                    build_sidecar.main()
            self.assertEqual(raised.exception.code, 2)
            run.assert_not_called()

    def test_builder_rejects_windows_target_on_32bit_python(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg.exe"
            ffmpeg.write_bytes(b"ffmpeg")

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(
                    build_sidecar, "host_triple", return_value="x86_64-pc-windows-msvc"
                ),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar.struct, "calcsize", return_value=4),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--target",
                        "x86_64-pc-windows-msvc",
                    ],
                ),
            ):
                with self.assertRaises(SystemExit) as raised:
                    build_sidecar.main()
            self.assertEqual(raised.exception.code, 2)
            run.assert_not_called()

    def test_cuda_builder_can_skip_audiocpp_and_stage_outside_tauri(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            onedir = root / "build" / "sidecar-dist" / "tts-sidecar-cuda" / "tts-sidecar-cuda"
            (onedir / "_internal").mkdir(parents=True)
            (onedir / "tts-sidecar-cuda").write_bytes(b"cuda sidecar")

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "SIDECAR_DIR", root / "sidecar"),
                patch.object(build_sidecar, "host_triple", return_value="x86_64-unknown-linux-gnu"),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar, "_stage_linux_ffmpeg", return_value=[]),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--target",
                        "x86_64-unknown-linux-gnu",
                        "--sidecar-name",
                        "tts-sidecar-cuda",
                        "--output-dir",
                        str(root / "cuda-out"),
                    ],
                ),
            ):
                build_sidecar.main()

            command = run.call_args.args[0]
            self.assertIn("tts-sidecar-cuda", command)
            staged = root / "cuda-out" / "tts-sidecar-cuda"
            self.assertEqual((staged / "tts-sidecar-cuda").read_bytes(), b"cuda sidecar")
            self.assertEqual(list(staged.glob("audiocpp-cli-*")), [])
            self.assertFalse((root / "sidecar").exists())

    def test_cuda_builder_stages_onedir_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            onedir = root / "build" / "sidecar-dist" / "tts-sidecar-cuda" / "tts-sidecar-cuda"
            (onedir / "_internal").mkdir(parents=True)
            executable = onedir / "tts-sidecar-cuda"
            executable.write_bytes(b"cuda executable")
            library = onedir / "_internal" / "libtorch.so"
            library.write_bytes(b"cuda library")
            link = onedir / "_internal" / "libtorch-link.so"
            link.symlink_to(library.name)

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "host_triple", return_value="x86_64-unknown-linux-gnu"),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar, "_stage_linux_ffmpeg", return_value=[]),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--target",
                        "x86_64-unknown-linux-gnu",
                        "--sidecar-name",
                        "tts-sidecar-cuda",
                        "--output-dir",
                        str(root / "cuda-out"),
                    ],
                ),
            ):
                build_sidecar.main()

            command = run.call_args.args[0]
            self.assertIn("--onedir", command)
            self.assertNotIn("--onefile", command)
            staged = root / "cuda-out" / "tts-sidecar-cuda"
            self.assertEqual((staged / "tts-sidecar-cuda").read_bytes(), b"cuda executable")
            self.assertEqual((staged / "_internal" / "libtorch.so").read_bytes(), b"cuda library")
            self.assertTrue((staged / "_internal" / "libtorch-link.so").is_symlink())

    def test_builder_bundles_macos_ffmpeg_as_staged_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            onedir = root / "build" / "sidecar-dist" / "tts-sidecar" / "tts-sidecar"
            (onedir / "_internal").mkdir(parents=True)
            (onedir / "tts-sidecar").write_bytes(b"sidecar")
            stage_dir = root / "build" / "ffmpeg-macos"
            (stage_dir / "ffmpeg-libs").mkdir(parents=True)
            (stage_dir / "ffmpeg").write_bytes(b"staged exe")
            (stage_dir / "ffmpeg-libs" / "libavutil.dylib").write_bytes(b"staged lib")
            staged_entries = [
                (stage_dir / "ffmpeg", "."),
                (stage_dir / "ffmpeg-libs", "ffmpeg-libs"),
            ]

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "SIDECAR_DIR", root / "sidecar"),
                patch.object(
                    build_sidecar, "_stage_macos_ffmpeg", return_value=staged_entries
                ) as stage,
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--target",
                        "aarch64-apple-darwin",
                    ],
                ),
            ):
                build_sidecar.main()

            stage.assert_called_once_with(ffmpeg.resolve(), stage_dir)
            command = run.call_args.args[0]
            self.assertNotIn("--add-binary", command)
            self.assertNotIn("--add-data", command)
            self.assertNotIn(f"{ffmpeg.resolve()}:.", command)
            staged = root / "sidecar" / "tts-sidecar"
            self.assertEqual((staged / "_internal" / "ffmpeg").read_bytes(), b"staged exe")
            self.assertEqual(
                (staged / "_internal" / "ffmpeg-libs" / "libavutil.dylib").read_bytes(),
                b"staged lib",
            )

    def test_stage_macos_ffmpeg_collects_and_relinks_closure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            brew_bin = root / "brew" / "bin"
            brew_lib = root / "brew" / "lib"
            brew_bin.mkdir(parents=True)
            brew_lib.mkdir()
            ffmpeg = brew_bin / "ffmpeg"
            ffmpeg.write_bytes(b"exe")
            util = brew_lib / "libavutil.60.8.100.dylib"
            util.write_bytes(b"util")
            (brew_lib / "libavutil.60.dylib").symlink_to(util.name)
            dav1d = brew_lib / "libdav1d.7.dylib"
            dav1d.write_bytes(b"dav1d")
            deps = {
                str(ffmpeg.resolve()): (
                    [f"{brew_lib}/libavutil.60.dylib", "/usr/lib/libSystem.B.dylib"],
                    [],
                ),
                str(util.resolve()): ([f"{brew_lib}/libdav1d.7.dylib"], []),
                str(dav1d.resolve()): (["/usr/lib/libSystem.B.dylib"], []),
            }

            with (
                patch.object(
                    build_sidecar,
                    "_macho_dependencies",
                    side_effect=lambda path: deps[str(path)],
                ),
                patch.object(build_sidecar.subprocess, "run") as run,
            ):
                staged = build_sidecar._stage_macos_ffmpeg(ffmpeg, root / "stage")

            stage_dir = root / "stage"
            self.assertEqual(
                staged,
                [
                    (stage_dir / "ffmpeg", "."),
                    (stage_dir / "ffmpeg-libs", "ffmpeg-libs"),
                ],
            )
            self.assertEqual((stage_dir / "ffmpeg").read_bytes(), b"exe")
            self.assertEqual(
                (stage_dir / "ffmpeg-libs" / "libavutil.60.8.100.dylib").read_bytes(), b"util"
            )
            self.assertEqual(
                (stage_dir / "ffmpeg-libs" / "libdav1d.7.dylib").read_bytes(), b"dav1d"
            )
            rewrites = {
                call.args[0][-1]: call.args[0]
                for call in run.call_args_list
                if call.args[0][0] == "install_name_tool"
            }
            self.assertIn(
                "@loader_path/ffmpeg-libs/libavutil.60.8.100.dylib",
                rewrites[str(stage_dir / "ffmpeg")],
            )
            self.assertIn(
                "@loader_path/libdav1d.7.dylib",
                rewrites[str(stage_dir / "ffmpeg-libs" / "libavutil.60.8.100.dylib")],
            )
            signed = [
                call.args[0]
                for call in run.call_args_list
                if call.args[0][0] == "codesign"
            ]
            self.assertEqual(len(signed), 3)

    def test_stage_macos_ffmpeg_fails_on_missing_dependency(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"exe")
            deps = {
                str(ffmpeg.resolve()): ([f"{root}/lib/libmissing.dylib"], []),
            }
            with patch.object(
                build_sidecar,
                "_macho_dependencies",
                side_effect=lambda path: deps[str(path)],
            ):
                with self.assertRaises(RuntimeError) as raised:
                    build_sidecar._stage_macos_ffmpeg(ffmpeg, root / "stage")
            self.assertIn("libmissing.dylib", str(raised.exception))

    def test_stage_macos_ffmpeg_makes_staged_files_writable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            brew_bin = root / "brew" / "bin"
            brew_lib = root / "brew" / "lib"
            brew_bin.mkdir(parents=True)
            brew_lib.mkdir()
            ffmpeg = brew_bin / "ffmpeg"
            ffmpeg.write_bytes(b"exe")
            ffmpeg.chmod(0o555)
            util = brew_lib / "libavutil.dylib"
            util.write_bytes(b"util")
            util.chmod(0o444)
            deps = {
                str(ffmpeg.resolve()): ([f"{brew_lib}/libavutil.dylib"], []),
                str(util.resolve()): ([], []),
            }

            with (
                patch.object(
                    build_sidecar,
                    "_macho_dependencies",
                    side_effect=lambda path: deps[str(path)],
                ),
                patch.object(build_sidecar.subprocess, "run"),
            ):
                staged = build_sidecar._stage_macos_ffmpeg(ffmpeg, root / "stage")

            for source, _ in staged:
                if source.is_dir():
                    staged_files = list(source.iterdir())
                else:
                    staged_files = [source]
                for staged_file in staged_files:
                    self.assertTrue(
                        staged_file.stat().st_mode & 0o200,
                        f"staged file is not owner-writable: {staged_file}",
                    )

    def test_builder_bundles_linux_ffmpeg_as_staged_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            onedir = root / "build" / "sidecar-dist" / "tts-sidecar" / "tts-sidecar"
            (onedir / "_internal").mkdir(parents=True)
            (onedir / "tts-sidecar").write_bytes(b"sidecar")
            stage_dir = root / "build" / "ffmpeg-linux"
            (stage_dir / "ffmpeg-libs").mkdir(parents=True)
            (stage_dir / "ffmpeg").write_bytes(b"staged exe")
            (stage_dir / "ffmpeg-libs" / "libavutil.so.60").write_bytes(b"staged lib")
            staged_entries = [
                (stage_dir / "ffmpeg", "."),
                (stage_dir / "ffmpeg-libs", "ffmpeg-libs"),
            ]

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "SIDECAR_DIR", root / "sidecar"),
                patch.object(
                    build_sidecar, "_stage_linux_ffmpeg", return_value=staged_entries
                ) as stage,
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--target",
                        "x86_64-unknown-linux-gnu",
                    ],
                ),
            ):
                build_sidecar.main()

            stage.assert_called_once_with(ffmpeg.resolve(), stage_dir)
            command = run.call_args.args[0]
            self.assertNotIn("--add-binary", command)
            self.assertNotIn("--add-data", command)
            self.assertNotIn(f"{ffmpeg.resolve()}:.", command)
            staged = root / "sidecar" / "tts-sidecar"
            self.assertEqual((staged / "_internal" / "ffmpeg").read_bytes(), b"staged exe")
            self.assertEqual(
                (staged / "_internal" / "ffmpeg-libs" / "libavutil.so.60").read_bytes(),
                b"staged lib",
            )

    def test_elf_dependencies_parses_ldd_output(self):
        ldd_output = (
            "\tlinux-vdso.so.1 (0x00007ffe5f1b0000)\n"
            "\tlibavutil.so.60 => /usr/lib/x86_64-linux-gnu/libavutil.so.60 (0x00007f9c7c600000)\n"
            "\tlibm.so.6 => /lib/x86_64-linux-gnu/libm.so.6 (0x00007f9c7c200000)\n"
            "\t/lib64/ld-linux-x86-64.so.2 (0x00007f9c7d000000)\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            ffmpeg = Path(tmp) / "ffmpeg"
            ffmpeg.write_bytes(b"elf")
            with patch.object(
                build_sidecar.subprocess, "check_output", return_value=ldd_output
            ) as check:
                deps = build_sidecar._elf_dependencies(ffmpeg)

            check.assert_called_once_with(["ldd", str(ffmpeg)], text=True)
            self.assertEqual(
                deps,
                [
                    ("libavutil.so.60", Path("/usr/lib/x86_64-linux-gnu/libavutil.so.60")),
                    ("libm.so.6", Path("/lib/x86_64-linux-gnu/libm.so.6")),
                ],
            )

    def test_elf_dependencies_fails_on_unresolved_library(self):
        ldd_output = "\tlibmissing.so.1 => not found\n"
        with tempfile.TemporaryDirectory() as tmp:
            ffmpeg = Path(tmp) / "ffmpeg"
            ffmpeg.write_bytes(b"elf")
            with (
                patch.object(
                    build_sidecar.subprocess, "check_output", return_value=ldd_output
                ),
                self.assertRaises(RuntimeError) as raised,
            ):
                build_sidecar._elf_dependencies(ffmpeg)
            self.assertIn("libmissing.so.1", str(raised.exception))

    def test_stage_linux_ffmpeg_collects_and_relinks_closure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            sys_bin = root / "sys" / "bin"
            sys_lib = root / "sys" / "lib"
            sys_bin.mkdir(parents=True)
            sys_lib.mkdir()
            ffmpeg = sys_bin / "ffmpeg"
            ffmpeg.write_bytes(b"exe")
            util = sys_lib / "libavutil.so.60.8.100"
            util.write_bytes(b"util")
            (sys_lib / "libavutil.so.60").symlink_to(util.name)
            dav1d = sys_lib / "libdav1d.so.7"
            dav1d.write_bytes(b"dav1d")
            libc = sys_lib / "libc.so.6"
            libc.write_bytes(b"libc")
            deps = {
                str(ffmpeg.resolve()): [
                    ("libavutil.so.60", sys_lib / "libavutil.so.60"),
                    ("libc.so.6", libc),
                ],
                str(util.resolve()): [("libdav1d.so.7", dav1d)],
                str(dav1d.resolve()): [("libc.so.6", libc)],
            }

            with (
                patch.object(
                    build_sidecar,
                    "_elf_dependencies",
                    side_effect=lambda path: deps[str(path)],
                ),
                patch.object(build_sidecar.subprocess, "run") as run,
            ):
                staged = build_sidecar._stage_linux_ffmpeg(ffmpeg, root / "stage")

            stage_dir = root / "stage"
            self.assertEqual(
                staged,
                [
                    (stage_dir / "ffmpeg", "."),
                    (stage_dir / "ffmpeg-libs", "ffmpeg-libs"),
                ],
            )
            self.assertEqual((stage_dir / "ffmpeg").read_bytes(), b"exe")
            self.assertEqual(
                (stage_dir / "ffmpeg-libs" / "libavutil.so.60").read_bytes(), b"util"
            )
            self.assertEqual((stage_dir / "ffmpeg-libs" / "libdav1d.so.7").read_bytes(), b"dav1d")
            self.assertEqual(len(list((stage_dir / "ffmpeg-libs").iterdir())), 2)
            relinked = {call.args[0][-1]: call.args[0] for call in run.call_args_list}
            self.assertEqual(
                relinked[str(stage_dir / "ffmpeg")],
                [
                    "patchelf",
                    "--force-rpath",
                    "--set-rpath",
                    "$ORIGIN/ffmpeg-libs",
                    str(stage_dir / "ffmpeg"),
                ],
            )
            for soname in ("libavutil.so.60", "libdav1d.so.7"):
                self.assertEqual(
                    relinked[str(stage_dir / "ffmpeg-libs" / soname)],
                    [
                        "patchelf",
                        "--force-rpath",
                        "--set-rpath",
                        "$ORIGIN",
                        str(stage_dir / "ffmpeg-libs" / soname),
                    ],
                )

    def test_stage_linux_ffmpeg_makes_staged_files_writable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            sys_bin = root / "sys" / "bin"
            sys_lib = root / "sys" / "lib"
            sys_bin.mkdir(parents=True)
            sys_lib.mkdir()
            ffmpeg = sys_bin / "ffmpeg"
            ffmpeg.write_bytes(b"exe")
            ffmpeg.chmod(0o555)
            util = sys_lib / "libavutil.so.60"
            util.write_bytes(b"util")
            util.chmod(0o444)
            deps = {
                str(ffmpeg.resolve()): [("libavutil.so.60", util)],
                str(util.resolve()): [],
            }

            with (
                patch.object(
                    build_sidecar,
                    "_elf_dependencies",
                    side_effect=lambda path: deps[str(path)],
                ),
                patch.object(build_sidecar.subprocess, "run"),
            ):
                staged = build_sidecar._stage_linux_ffmpeg(ffmpeg, root / "stage")

            for source, _ in staged:
                if source.is_dir():
                    staged_files = list(source.iterdir())
                else:
                    staged_files = [source]
                for staged_file in staged_files:
                    self.assertTrue(
                        staged_file.stat().st_mode & 0o200,
                        f"staged file is not owner-writable: {staged_file}",
                    )

    def test_stage_linux_ffmpeg_fails_on_soname_collision(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"exe")
            lib_a = root / "a" / "libfoo.so.1"
            lib_b = root / "b" / "libfoo.so.1"
            lib_a.parent.mkdir()
            lib_b.parent.mkdir()
            lib_a.write_bytes(b"a")
            lib_b.write_bytes(b"b")
            deps = {
                str(ffmpeg.resolve()): [("libfoo.so.1", lib_a), ("libbar.so.2", lib_b)],
                str(lib_a.resolve()): [("libfoo.so.1", lib_b)],
                str(lib_b.resolve()): [],
            }

            with patch.object(
                build_sidecar,
                "_elf_dependencies",
                side_effect=lambda path: deps[str(path)],
            ):
                with self.assertRaises(RuntimeError) as raised:
                    build_sidecar._stage_linux_ffmpeg(ffmpeg, root / "stage")
            self.assertIn("libfoo.so.1", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
