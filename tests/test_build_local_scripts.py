import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "scripts" / "build_local_common.sh"
PS_TAIL = (
    " -Preset windows-cpu-release -ModelSet custom -Models 'vieneu_v3_turbo'"
    " -Target audiocpp_cli -CpuArch baseline;"
    " if (-not $?) { exit 1 }; if ($LASTEXITCODE) { exit $LASTEXITCODE }"
)


def ps_command(script_path: str) -> str:
    return subprocess.check_output(
        [
            "bash",
            "-c",
            'source "$1" && audiocpp_ps_command "$2"',
            "bash",
            str(HELPER),
            script_path,
        ],
        text=True,
        cwd=ROOT,
    )


@unittest.skipUnless(shutil.which("bash"), "bash is required to source the helper")
class AudiocppPsCommandTests(unittest.TestCase):
    def test_plain_path(self):
        path = r"C:\repo\build\audio.cpp\scripts\build_windows.ps1"
        self.assertEqual(ps_command(path), f"& '{path}'{PS_TAIL}")

    def test_apostrophes_are_doubled_for_powershell(self):
        path = r"C:\Users\O'Neil's\repo\build_windows.ps1"
        expected = "& 'C:\\Users\\O''Neil''s\\repo\\build_windows.ps1'" + PS_TAIL
        self.assertEqual(ps_command(path), expected)


if __name__ == "__main__":
    unittest.main()
