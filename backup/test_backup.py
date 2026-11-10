"""Run with: python3 -m unittest discover -s backup -p 'test_*.py'."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class BackupRetentionTest(unittest.TestCase):
    def run_backup(self, names, fail=""):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "database").touch()
            (root / "secret").write_text("test config")
            script = Path(__file__).with_name("backup.sh").read_text()
            for original, replacement in {
                "/data/tournament.db": str(root / "database"),
                "backup_dir=/backups": f"backup_dir={root}",
                "/run/secrets/rclone.conf": str(root / "secret"),
                "/tmp/rclone.conf": str(root / "config"),
            }.items():
                script = script.replace(original, replacement)
            (root / "backup.sh").write_text(script)
            mocks = {
                "sqlite3": """#!/usr/bin/env python3
import pathlib, sys
if sys.argv[-1].startswith('.backup '):
    pathlib.Path(sys.argv[-1].split("'")[1]).write_text('snapshot')
else:
    print('ok')
""",
                "rclone": """#!/usr/bin/env python3
import json, os, sys
args = sys.argv[2:]
with open(os.environ['CALL_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\\n')
if args[0] == os.environ['FAIL_COMMAND']:
    sys.exit(1)
if args[0] == 'listremotes':
    print('onedrive:')
elif args[0] == 'lsf':
    print(os.environ['BACKUP_NAMES'])
""",
            }
            for name, content in mocks.items():
                executable = root / name
                executable.write_text(content)
                executable.chmod(0o755)
            result = subprocess.run(
                ["sh", str(root / "backup.sh")], capture_output=True, text=True,
                env={**os.environ, "PATH": f"{root}:{os.environ['PATH']}",
                     "CALL_LOG": str(root / "calls"), "FAIL_COMMAND": fail,
                     "BACKUP_NAMES": "\n".join(names)},
            )
            calls = [json.loads(line) for line in (root / "calls").read_text().splitlines()]
            return result.returncode, calls

    def test_keeps_newest_three_and_ignores_other_files(self):
        names = [f"tournament-202611{day:02d}T000000Z.db.gz" for day in (3, 1, 5, 2, 4)]
        code, calls = self.run_backup(names + ["notes.txt", "other/tournament-20260101T000000Z.db.gz"])
        self.assertEqual(code, 0)
        deleted = [Path(call[1]).name for call in calls if call[0] == "deletefile"]
        self.assertEqual(deleted, [names[3], names[1]])
        self.assertLess([c[0] for c in calls].index("copyto"), [c[0] for c in calls].index("deletefile"))

    def test_three_or_fewer_backups_need_no_deletion(self):
        for count in range(4):
            code, calls = self.run_backup([f"tournament-2026110{day}T000000Z.db.gz" for day in range(1, count + 1)])
            self.assertEqual(code, 0)
            self.assertFalse(any(call[0] == "deletefile" for call in calls))

    def test_failed_upload_or_listing_does_not_delete(self):
        for command in ("copyto", "lsf"):
            code, calls = self.run_backup([], fail=command)
            self.assertNotEqual(code, 0)
            self.assertFalse(any(call[0] == "deletefile" for call in calls))

    def test_deletion_failure_fails_job(self):
        code, _ = self.run_backup([f"tournament-2026110{day}T000000Z.db.gz" for day in range(1, 5)], fail="deletefile")
        self.assertNotEqual(code, 0)
