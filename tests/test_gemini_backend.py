"""Tests for the Gemini backend."""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from phone_a_friend.backends.gemini import GEMINI_BACKEND, GeminiBackendError
import sys

from phone_a_friend.relay import relay

relay_mod = sys.modules["phone_a_friend.relay"]


class TestGeminiBackend(unittest.TestCase):
    def test_uses_repo_and_returns_stdout(self):
        observed_cmd: list[str] = []
        observed_kwargs: dict = {}

        def fake_run(cmd, **kwargs):
            observed_cmd[:] = cmd
            observed_kwargs.update(kwargs)
            return subprocess.CompletedProcess(cmd, 0, stdout="Gemini feedback", stderr="")

        with (
            patch("phone_a_friend.backends.gemini.shutil.which", return_value="gemini"),
            patch("phone_a_friend.backends.gemini.subprocess.run", side_effect=fake_run),
        ):
            result = GEMINI_BACKEND.run(
                prompt="Review implementation.",
                repo_path=Path("/tmp/repo"),
                timeout_seconds=60,
                sandbox="read-only",
                model=None,
                env={},
            )

        self.assertEqual(result, "Gemini feedback")
        self.assertEqual(observed_cmd[0], "gemini")
        self.assertIn("--sandbox", observed_cmd)
        self.assertIn("--yolo", observed_cmd)
        self.assertIn("--include-directories", observed_cmd)
        self.assertIn("/tmp/repo", observed_cmd)
        self.assertIn("--output-format", observed_cmd)
        # Prompt passed via --prompt flag, not as bare positional arg.
        prompt_idx = observed_cmd.index("--prompt")
        self.assertEqual(observed_cmd[prompt_idx + 1], "Review implementation.")
        self.assertNotIn("exec", observed_cmd)
        # cwd should be set to repo_path.
        self.assertEqual(observed_kwargs["cwd"], Path("/tmp/repo"))

    def test_sandbox_omitted_for_full_access(self):
        observed_cmd: list[str] = []

        def fake_run(cmd, **_kwargs):
            observed_cmd[:] = cmd
            return subprocess.CompletedProcess(cmd, 0, stdout="ok", stderr="")

        with (
            patch("phone_a_friend.backends.gemini.shutil.which", return_value="gemini"),
            patch("phone_a_friend.backends.gemini.subprocess.run", side_effect=fake_run),
        ):
            GEMINI_BACKEND.run(
                prompt="x",
                repo_path=Path("/tmp/repo"),
                timeout_seconds=60,
                sandbox="danger-full-access",
                model=None,
                env={},
            )

        self.assertNotIn("--sandbox", observed_cmd)
        self.assertIn("--yolo", observed_cmd)

    def test_raises_when_gemini_not_found(self):
        with patch("phone_a_friend.backends.gemini.shutil.which", return_value=None):
            with self.assertRaises(GeminiBackendError) as ctx:
                GEMINI_BACKEND.run(
                    prompt="x",
                    repo_path=Path("/tmp"),
                    timeout_seconds=60,
                    sandbox="read-only",
                    model=None,
                    env={},
                )
        self.assertIn("gemini CLI not found", str(ctx.exception))

    def test_timeout_raises(self):
        with (
            patch("phone_a_friend.backends.gemini.shutil.which", return_value="gemini"),
            patch(
                "phone_a_friend.backends.gemini.subprocess.run",
                side_effect=subprocess.TimeoutExpired(cmd="gemini", timeout=10),
            ),
        ):
            with self.assertRaises(GeminiBackendError) as ctx:
                GEMINI_BACKEND.run(
                    prompt="x",
                    repo_path=Path("/tmp"),
                    timeout_seconds=10,
                    sandbox="read-only",
                    model=None,
                    env={},
                )
        self.assertIn("timed out", str(ctx.exception))

    def test_non_zero_exit_raises(self):
        with (
            patch("phone_a_friend.backends.gemini.shutil.which", return_value="gemini"),
            patch("phone_a_friend.backends.gemini.subprocess.run") as mock_run,
        ):
            mock_run.return_value = subprocess.CompletedProcess(
                [], 1, stdout="", stderr="something went wrong"
            )
            with self.assertRaises(GeminiBackendError) as ctx:
                GEMINI_BACKEND.run(
                    prompt="x",
                    repo_path=Path("/tmp"),
                    timeout_seconds=60,
                    sandbox="read-only",
                    model=None,
                    env={},
                )
        self.assertIn("something went wrong", str(ctx.exception))

    def test_no_output_raises(self):
        with (
            patch("phone_a_friend.backends.gemini.shutil.which", return_value="gemini"),
            patch("phone_a_friend.backends.gemini.subprocess.run") as mock_run,
        ):
            mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="", stderr="")
            with self.assertRaises(GeminiBackendError) as ctx:
                GEMINI_BACKEND.run(
                    prompt="x",
                    repo_path=Path("/tmp"),
                    timeout_seconds=60,
                    sandbox="read-only",
                    model=None,
                    env={},
                )
        self.assertIn("without producing output", str(ctx.exception))

    def test_relay_to_gemini(self):
        repo = Path(tempfile.mkdtemp(prefix="phone-a-friend-test-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(repo, ignore_errors=True))

        with (
            patch("phone_a_friend.backends.gemini.shutil.which", return_value="gemini"),
            patch("phone_a_friend.backends.gemini.subprocess.run") as mock_run,
            patch.object(relay_mod, "_git_diff", return_value=""),
        ):
            mock_run.return_value = subprocess.CompletedProcess([], 0, stdout="Gemini says hi", stderr="")

            result = relay(
                prompt="Hello Gemini",
                repo_path=repo,
                backend="gemini",
            )

        self.assertEqual(result, "Gemini says hi")


if __name__ == "__main__":
    unittest.main()
