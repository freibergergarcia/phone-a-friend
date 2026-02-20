"""Tests for phone_a_friend.installer."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from phone_a_friend import installer


class TestInstaller(unittest.TestCase):
    def _make_repo(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        tmp = tempfile.TemporaryDirectory(prefix="phone-a-friend-repo-")
        repo = Path(tmp.name)
        (repo / ".claude-plugin").mkdir(parents=True, exist_ok=True)
        (repo / ".claude-plugin" / "plugin.json").write_text('{"name":"phone-a-friend"}')
        return tmp, repo

    def _make_home(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        tmp = tempfile.TemporaryDirectory(prefix="phone-a-friend-home-")
        return tmp, Path(tmp.name)

    def test_install_hosts_symlink(self):
        repo_tmp, repo = self._make_repo()
        home_tmp, claude_home = self._make_home()
        self.addCleanup(repo_tmp.cleanup)
        self.addCleanup(home_tmp.cleanup)

        lines = installer.install_hosts(
            repo_root=repo,
            target="claude",
            mode="symlink",
            force=False,
            claude_home=claude_home,
            sync_claude_cli=False,
        )

        target = claude_home / "plugins" / "phone-a-friend"
        self.assertTrue(target.is_symlink())
        self.assertEqual(target.resolve(), repo.resolve())
        self.assertTrue(any(line.startswith("- claude: installed") for line in lines))

    def test_install_hosts_copy(self):
        repo_tmp, repo = self._make_repo()
        home_tmp, claude_home = self._make_home()
        self.addCleanup(repo_tmp.cleanup)
        self.addCleanup(home_tmp.cleanup)

        lines = installer.install_hosts(
            repo_root=repo,
            target="claude",
            mode="copy",
            force=False,
            claude_home=claude_home,
            sync_claude_cli=False,
        )

        target = claude_home / "plugins" / "phone-a-friend"
        self.assertTrue(target.is_dir())
        self.assertFalse(target.is_symlink())
        self.assertTrue((target / ".claude-plugin" / "plugin.json").exists())
        self.assertTrue(any(line.startswith("- claude: installed") for line in lines))

    def test_install_hosts_invalid_repo_root_raises(self):
        tmp = tempfile.TemporaryDirectory(prefix="phone-a-friend-invalid-")
        self.addCleanup(tmp.cleanup)
        invalid_repo = Path(tmp.name)
        with self.assertRaises(RuntimeError):
            installer.install_hosts(
                repo_root=invalid_repo,
                target="claude",
                sync_claude_cli=False,
            )

    def test_uninstall_hosts(self):
        repo_tmp, repo = self._make_repo()
        home_tmp, claude_home = self._make_home()
        self.addCleanup(repo_tmp.cleanup)
        self.addCleanup(home_tmp.cleanup)

        installer.install_hosts(
            repo_root=repo,
            target="claude",
            mode="symlink",
            force=False,
            claude_home=claude_home,
            sync_claude_cli=False,
        )

        lines = installer.uninstall_hosts(target="claude", claude_home=claude_home)
        target = claude_home / "plugins" / "phone-a-friend"
        self.assertFalse(target.exists() or target.is_symlink())
        self.assertTrue(any(line.startswith("- claude: removed") for line in lines))

    def test_verify_backends(self):
        def which_side_effect(name):
            return "/usr/bin/codex" if name == "codex" else None

        with patch("phone_a_friend.backends.shutil.which", side_effect=which_side_effect):
            results = installer.verify_backends()

        by_name = {r["name"]: r for r in results}
        self.assertTrue(by_name["codex"]["available"])
        self.assertFalse(by_name["gemini"]["available"])
        self.assertIn("npm", str(by_name["gemini"]["hint"]))

    def test_sync_skips_when_claude_missing(self):
        repo_tmp, repo = self._make_repo()
        self.addCleanup(repo_tmp.cleanup)

        with patch("phone_a_friend.installer.shutil.which", return_value=None):
            lines = installer._sync_claude_plugin_registration(repo)

        self.assertEqual(lines, ["- claude_cli: skipped (claude binary not found)"])


if __name__ == "__main__":
    unittest.main()
