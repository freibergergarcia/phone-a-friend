"""Tests for the relay module."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from phone_a_friend.relay import RelayError, relay


class TestRelay(unittest.TestCase):
    def setUp(self) -> None:
        # Keep relay tests hermetic even when the outer environment already
        # runs under relay depth tracking.
        self._depth_patch = patch.dict(
            os.environ,
            {"PHONE_A_FRIEND_DEPTH": "0"},
            clear=False,
        )
        self._depth_patch.start()
        self.addCleanup(self._depth_patch.stop)

    def _make_repo(self) -> Path:
        temp_dir = tempfile.TemporaryDirectory(prefix="phone-a-friend-test-")
        self.addCleanup(temp_dir.cleanup)
        return Path(temp_dir.name)

    def test_uses_repo_and_returns_last_message(self):
        repo = self._make_repo()
        observed_cmd: list[str] = []

        def fake_run(cmd, **_kwargs):
            observed_cmd[:] = cmd
            output_index = cmd.index("--output-last-message") + 1
            Path(cmd[output_index]).write_text("Codex feedback")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run", side_effect=fake_run),
        ):
            result = relay(
                prompt="Review the latest implementation.",
                repo_path=repo,
                include_diff=False,
            )

        self.assertEqual(result, "Codex feedback")
        self.assertIn("-C", observed_cmd)
        self.assertIn(str(repo.resolve()), observed_cmd)
        self.assertIn("--skip-git-repo-check", observed_cmd)
        self.assertEqual(observed_cmd[0], "codex")
        self.assertEqual(observed_cmd[1], "exec")

    def test_default_sandbox_is_read_only(self):
        repo = self._make_repo()
        observed_cmd: list[str] = []

        def fake_run(cmd, **_kwargs):
            observed_cmd[:] = cmd
            output_index = cmd.index("--output-last-message") + 1
            Path(cmd[output_index]).write_text("sandbox feedback")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run", side_effect=fake_run),
        ):
            relay(prompt="Review", repo_path=repo)

        sandbox_index = observed_cmd.index("--sandbox") + 1
        self.assertEqual(observed_cmd[sandbox_index], "read-only")

    def test_include_diff_adds_git_diff_to_prompt(self):
        repo = self._make_repo()
        codex_prompt = ""

        def fake_codex(cmd, **_kwargs):
            nonlocal codex_prompt
            codex_prompt = cmd[-1]
            output_index = cmd.index("--output-last-message") + 1
            Path(cmd[output_index]).write_text("diff-aware feedback")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with (
            patch("phone_a_friend.relay._git_diff", return_value="diff --git a/a.py b/a.py"),
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run", side_effect=fake_codex),
        ):
            result = relay(
                prompt="Review this diff.",
                repo_path=repo,
                include_diff=True,
            )

        self.assertEqual(result, "diff-aware feedback")
        self.assertIn("Git Diff:", codex_prompt)
        self.assertIn("diff --git a/a.py b/a.py", codex_prompt)

    def test_raises_when_codex_not_found(self):
        repo = self._make_repo()
        with patch("phone_a_friend.backends.codex.shutil.which", return_value=None):
            with self.assertRaises(RelayError) as ctx:
                relay(prompt="x", repo_path=repo)
        self.assertIn("codex CLI not found", str(ctx.exception))

    def test_non_zero_exit_raises_relay_error(self):
        repo = self._make_repo()

        def fake_run(cmd, **_kwargs):
            return subprocess.CompletedProcess(cmd, 2, stdout="", stderr="codex failed")

        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run", side_effect=fake_run),
        ):
            with self.assertRaises(RelayError) as ctx:
                relay(prompt="Run a review", repo_path=repo)

        self.assertIn("codex failed", str(ctx.exception))

    def test_timeout_raises_clean_relay_error(self):
        repo = self._make_repo()

        def fake_run(cmd, **_kwargs):
            raise subprocess.TimeoutExpired(cmd=cmd, timeout=10)

        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run", side_effect=fake_run),
        ):
            with self.assertRaises(RelayError) as ctx:
                relay(prompt="Run a review", repo_path=repo, timeout_seconds=10)

        self.assertIn("timed out", str(ctx.exception))

    def test_depth_guard_raises_before_codex_invocation(self):
        repo = self._make_repo()
        with (
            patch.dict(os.environ, {"PHONE_A_FRIEND_DEPTH": "1"}, clear=False),
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run") as mock_run,
        ):
            with self.assertRaises(RelayError) as ctx:
                relay(prompt="Run a review", repo_path=repo)

        self.assertIn("Relay depth limit", str(ctx.exception))
        mock_run.assert_not_called()

    def test_empty_prompt_raises(self):
        repo = self._make_repo()
        with self.assertRaises(RelayError) as ctx:
            relay(prompt="   ", repo_path=repo)
        self.assertIn("Prompt is required", str(ctx.exception))

    def test_invalid_repo_raises(self):
        missing_repo = Path(tempfile.gettempdir()) / f"phone-a-friend-missing-{uuid.uuid4().hex}"
        with self.assertRaises(RelayError) as ctx:
            relay(prompt="test", repo_path=missing_repo)
        self.assertIn("Repository path does not exist", str(ctx.exception))

    def test_context_file_not_found_raises(self):
        repo = self._make_repo()
        missing_context = repo / "missing.md"
        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run"),
        ):
            with self.assertRaises(RelayError) as ctx:
                relay(prompt="Review", repo_path=repo, context_file=missing_context)
        self.assertIn("Context file does not exist", str(ctx.exception))

    def test_context_file_directory_raises(self):
        repo = self._make_repo()
        context_dir = repo / "ctx"
        context_dir.mkdir()
        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run"),
        ):
            with self.assertRaises(RelayError) as ctx:
                relay(prompt="Review", repo_path=repo, context_file=context_dir)
        self.assertIn("Context path is not a file", str(ctx.exception))

    def test_context_text_is_appended_to_prompt(self):
        repo = self._make_repo()
        codex_prompt = ""

        def fake_run(cmd, **_kwargs):
            nonlocal codex_prompt
            codex_prompt = cmd[-1]
            output_index = cmd.index("--output-last-message") + 1
            Path(cmd[output_index]).write_text("context-aware feedback")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run", side_effect=fake_run),
        ):
            result = relay(
                prompt="Review",
                repo_path=repo,
                context_text="This is inline context.",
            )

        self.assertEqual(result, "context-aware feedback")
        self.assertIn("Additional Context:", codex_prompt)
        self.assertIn("This is inline context.", codex_prompt)

    def test_rejects_context_file_and_context_text_together(self):
        repo = self._make_repo()
        context_file = repo / "context.md"
        context_file.write_text("from file")

        with patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"):
            with self.assertRaises(RelayError) as ctx:
                relay(
                    prompt="Review",
                    repo_path=repo,
                    context_file=context_file,
                    context_text="from inline",
                )

        self.assertIn("either context_file or context_text", str(ctx.exception))

    def test_stdout_fallback_is_used_when_output_file_missing(self):
        repo = self._make_repo()

        def fake_run(cmd, **_kwargs):
            return subprocess.CompletedProcess(cmd, 0, stdout="stdout feedback", stderr="")

        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run", side_effect=fake_run),
        ):
            result = relay(prompt="Review", repo_path=repo)

        self.assertEqual(result, "stdout feedback")

    def test_no_output_raises(self):
        repo = self._make_repo()

        def fake_run(cmd, **_kwargs):
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run", side_effect=fake_run),
        ):
            with self.assertRaises(RelayError) as ctx:
                relay(prompt="Review", repo_path=repo)

        self.assertIn("without producing feedback", str(ctx.exception))

    def test_git_diff_failure_raises(self):
        repo = self._make_repo()

        def fake_run(cmd, **_kwargs):
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="not a git repository")

        with (
            patch("phone_a_friend.relay.subprocess.run", side_effect=fake_run),
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run"),
        ):
            with self.assertRaises(RelayError) as ctx:
                relay(prompt="Review", repo_path=repo, include_diff=True)

        self.assertIn("Failed to collect git diff", str(ctx.exception))

    def test_invalid_sandbox_raises(self):
        repo = self._make_repo()
        with self.assertRaises(RelayError) as ctx:
            relay(prompt="Review", repo_path=repo, sandbox="totally-unsafe")
        self.assertIn("Invalid sandbox mode", str(ctx.exception))

    def test_unsupported_backend_raises(self):
        repo = self._make_repo()
        with self.assertRaises(RelayError) as ctx:
            relay(prompt="Review", repo_path=repo, backend="unknown")
        self.assertIn("Unsupported relay backend", str(ctx.exception))

    def test_context_text_at_size_limit_passes(self):
        repo = self._make_repo()

        def fake_run(cmd, **_kwargs):
            output_index = cmd.index("--output-last-message") + 1
            Path(cmd[output_index]).write_text("ok")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        # Exactly at the 200KB limit should not raise.
        context = "a" * 200_000
        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run", side_effect=fake_run),
        ):
            result = relay(prompt="Review", repo_path=repo, context_text=context)
        self.assertEqual(result, "ok")

    def test_context_text_over_size_limit_raises(self):
        repo = self._make_repo()
        context = "a" * 200_001
        with self.assertRaises(RelayError) as ctx:
            relay(prompt="Review", repo_path=repo, context_text=context)
        self.assertIn("too large", str(ctx.exception))

    def test_prompt_over_size_limit_raises(self):
        repo = self._make_repo()
        big_prompt = "a" * 500_001
        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
        ):
            with self.assertRaises(RelayError) as ctx:
                relay(prompt=big_prompt, repo_path=repo)
        self.assertIn("too large", str(ctx.exception))

    def test_codex_output_file_oserror_raises(self):
        repo = self._make_repo()

        def fake_run(cmd, **_kwargs):
            output_index = cmd.index("--output-last-message") + 1
            output_path = Path(cmd[output_index])
            # Create a directory where the file should be, causing OSError on read.
            output_path.mkdir(parents=True, exist_ok=True)
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with (
            patch("phone_a_friend.backends.codex.shutil.which", return_value="codex"),
            patch("phone_a_friend.backends.codex.subprocess.run", side_effect=fake_run),
        ):
            with self.assertRaises(RelayError) as ctx:
                relay(prompt="Review", repo_path=repo)
        self.assertIn("Failed reading Codex output file", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
