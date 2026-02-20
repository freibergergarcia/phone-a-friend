"""Tests for phone_a_friend.cli."""

from __future__ import annotations

import importlib
import io
import unittest
from pathlib import Path
from unittest.mock import patch

from phone_a_friend import cli

_has_typer = importlib.util.find_spec("typer") is not None


class TestRunRelay(unittest.TestCase):
    def test_run_relay_prints_feedback(self):
        with (
            patch("phone_a_friend.cli.relay", return_value="Looks good") as mock_relay,
            patch("sys.stdout", new_callable=io.StringIO) as out,
        ):
            exit_code = cli._run_relay(
                to="codex",
                repo=Path("/tmp/repo"),
                prompt="Review",
                context_file=None,
                context_text="inline",
                include_diff=True,
                timeout=123,
                model="o3",
                sandbox="read-only",
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(out.getvalue().strip(), "Looks good")
        mock_relay.assert_called_once()
        kwargs = mock_relay.call_args.kwargs
        self.assertEqual(kwargs["backend"], "codex")
        self.assertEqual(kwargs["repo_path"], Path("/tmp/repo"))
        self.assertEqual(kwargs["prompt"], "Review")
        self.assertEqual(kwargs["context_text"], "inline")
        self.assertTrue(kwargs["include_diff"])
        self.assertEqual(kwargs["timeout_seconds"], 123)
        self.assertEqual(kwargs["model"], "o3")
        self.assertEqual(kwargs["sandbox"], "read-only")


class TestRunInstall(unittest.TestCase):
    def test_run_install_calls_installer(self):
        with (
            patch("phone_a_friend.cli.install_hosts", return_value=["phone-a-friend installer"]) as mock_install,
            patch.object(cli, "_print_result_lines") as mock_print,
        ):
            exit_code = cli._run_install(
                claude=True,
                all_targets=False,
                mode="symlink",
                force=False,
                repo_root=Path("/tmp/repo"),
                no_claude_cli_sync=True,
            )

        self.assertEqual(exit_code, 0)
        mock_install.assert_called_once()
        kwargs = mock_install.call_args.kwargs
        self.assertEqual(kwargs["repo_root"], Path("/tmp/repo"))
        self.assertEqual(kwargs["target"], "claude")
        self.assertEqual(kwargs["mode"], "symlink")
        self.assertFalse(kwargs["force"])
        self.assertFalse(kwargs["sync_claude_cli"])
        mock_print.assert_called_once_with(["phone-a-friend installer"])


class TestRunUninstall(unittest.TestCase):
    def test_run_uninstall_calls_installer(self):
        with (
            patch("phone_a_friend.cli.uninstall_hosts", return_value=["phone-a-friend uninstaller"]) as mock_uninstall,
            patch.object(cli, "_print_result_lines") as mock_print,
        ):
            exit_code = cli._run_uninstall(
                claude=True,
                all_targets=False,
            )

        self.assertEqual(exit_code, 0)
        mock_uninstall.assert_called_once_with(target="claude")
        mock_print.assert_called_once_with(["phone-a-friend uninstaller"])


class TestRunUpdate(unittest.TestCase):
    def test_run_update_forces_install(self):
        with patch.object(cli, "_run_install", return_value=0) as mock_install:
            exit_code = cli._run_update(
                mode="copy",
                repo_root=Path("/tmp/repo"),
                no_claude_cli_sync=True,
            )

        self.assertEqual(exit_code, 0)
        mock_install.assert_called_once_with(
            claude=True,
            all_targets=False,
            mode="copy",
            force=True,
            repo_root=Path("/tmp/repo"),
            no_claude_cli_sync=True,
        )


class TestArgparse(unittest.TestCase):
    def test_argparse_relay_routes_to_run_relay(self):
        with patch.object(cli, "_run_relay", return_value=0) as mock_run:
            exit_code = cli._run_argparse_fallback(
                [
                    "relay",
                    "--to",
                    "codex",
                    "--repo",
                    "/tmp/repo",
                    "--prompt",
                    "Review latest changes",
                    "--context-file",
                    "/tmp/context.txt",
                    "--include-diff",
                    "--timeout",
                    "120",
                    "--model",
                    "o3",
                    "--sandbox",
                    "workspace-write",
                ]
            )

        self.assertEqual(exit_code, 0)
        mock_run.assert_called_once()
        kwargs = mock_run.call_args.kwargs
        self.assertEqual(kwargs["to"], "codex")
        self.assertEqual(kwargs["repo"], Path("/tmp/repo"))
        self.assertEqual(kwargs["prompt"], "Review latest changes")
        self.assertEqual(kwargs["context_file"], Path("/tmp/context.txt"))
        self.assertIsNone(kwargs["context_text"])
        self.assertTrue(kwargs["include_diff"])
        self.assertEqual(kwargs["timeout"], 120)
        self.assertEqual(kwargs["model"], "o3")
        self.assertEqual(kwargs["sandbox"], "workspace-write")

    def test_argparse_root_relay_compatibility(self):
        with patch.object(cli, "_run_relay", return_value=0) as mock_run:
            exit_code = cli._run_argparse_fallback(
                [
                    "--repo",
                    "/tmp/repo",
                    "--prompt",
                    "Review latest changes",
                ]
            )

        self.assertEqual(exit_code, 0)
        kwargs = mock_run.call_args.kwargs
        self.assertEqual(kwargs["sandbox"], "read-only")

    def test_argparse_install_routes_to_run_install(self):
        with patch.object(cli, "_run_install", return_value=0) as mock_run_install:
            exit_code = cli._run_argparse_fallback(
                [
                    "install",
                    "--claude",
                    "--mode",
                    "copy",
                    "--force",
                    "--repo-root",
                    "/tmp/repo",
                    "--no-claude-cli-sync",
                ]
            )

        self.assertEqual(exit_code, 0)
        kwargs = mock_run_install.call_args.kwargs
        self.assertTrue(kwargs["claude"])
        self.assertFalse(kwargs["all_targets"])
        self.assertEqual(kwargs["mode"], "copy")
        self.assertTrue(kwargs["force"])
        self.assertEqual(kwargs["repo_root"], Path("/tmp/repo"))
        self.assertTrue(kwargs["no_claude_cli_sync"])

    def test_argparse_uninstall_routes_to_run_uninstall(self):
        with patch.object(cli, "_run_uninstall", return_value=0) as mock_run_uninstall:
            exit_code = cli._run_argparse_fallback(["uninstall", "--claude"])

        self.assertEqual(exit_code, 0)
        kwargs = mock_run_uninstall.call_args.kwargs
        self.assertTrue(kwargs["claude"])
        self.assertFalse(kwargs["all_targets"])

    def test_argparse_update_routes_to_run_update(self):
        with patch.object(cli, "_run_update", return_value=0) as mock_run_update:
            exit_code = cli._run_argparse_fallback(
                [
                    "update",
                    "--mode",
                    "copy",
                    "--repo-root",
                    "/tmp/repo",
                    "--no-claude-cli-sync",
                ]
            )

        self.assertEqual(exit_code, 0)
        kwargs = mock_run_update.call_args.kwargs
        self.assertEqual(kwargs["mode"], "copy")
        self.assertEqual(kwargs["repo_root"], Path("/tmp/repo"))
        self.assertTrue(kwargs["no_claude_cli_sync"])

    def test_argparse_rejects_both_context_flags(self):
        with self.assertRaises(SystemExit):
            cli._run_argparse_fallback(
                [
                    "relay",
                    "--to",
                    "codex",
                    "--repo",
                    "/tmp/repo",
                    "--prompt",
                    "Review latest changes",
                    "--context-file",
                    "/tmp/context.txt",
                    "--context-text",
                    "inline context",
                ]
            )

    def test_argparse_prompt_is_required(self):
        with self.assertRaises(SystemExit):
            cli._run_argparse_fallback(["relay", "--to", "codex"])


@unittest.skipUnless(_has_typer, "typer is not installed")
class TestTyper(unittest.TestCase):
    def test_typer_root_relay_compatibility(self):
        with patch.object(cli, "_run_relay", return_value=0) as mock_run:
            with self.assertRaises(SystemExit) as ctx:
                cli._run_typer(
                    [
                        "--to",
                        "codex",
                        "--repo",
                        "/tmp/repo",
                        "--prompt",
                        "Review latest changes",
                    ]
                )

        self.assertEqual(ctx.exception.code, 0)
        kwargs = mock_run.call_args.kwargs
        self.assertEqual(kwargs["to"], "codex")
        self.assertEqual(kwargs["repo"], Path("/tmp/repo"))
        self.assertEqual(kwargs["prompt"], "Review latest changes")
        self.assertEqual(kwargs["sandbox"], "read-only")

    def test_typer_install_routes(self):
        with patch.object(cli, "_run_install", return_value=0) as mock_run_install:
            with self.assertRaises(SystemExit) as ctx:
                cli._run_typer(["install", "--claude", "--no-claude-cli-sync"])

        self.assertEqual(ctx.exception.code, 0)
        kwargs = mock_run_install.call_args.kwargs
        self.assertTrue(kwargs["claude"])
        self.assertFalse(kwargs["all_targets"])
        self.assertTrue(kwargs["no_claude_cli_sync"])

    def test_typer_update_routes(self):
        with patch.object(cli, "_run_update", return_value=0) as mock_run_update:
            with self.assertRaises(SystemExit) as ctx:
                cli._run_typer(["update", "--repo-root", "/tmp/repo"])

        self.assertEqual(ctx.exception.code, 0)
        kwargs = mock_run_update.call_args.kwargs
        self.assertEqual(kwargs["mode"], "symlink")
        self.assertEqual(kwargs["repo_root"], Path("/tmp/repo"))
        self.assertFalse(kwargs["no_claude_cli_sync"])

    def test_typer_rejects_both_context_inputs(self):
        with self.assertRaises(SystemExit) as ctx:
            cli._run_typer(
                [
                    "--repo",
                    "/tmp/repo",
                    "--prompt",
                    "Review latest changes",
                    "--context-file",
                    "/tmp/context.txt",
                    "--context-text",
                    "inline context",
                ]
            )

        self.assertEqual(ctx.exception.code, 1)


class TestMain(unittest.TestCase):
    def test_main_falls_back_to_argparse_when_typer_missing(self):
        missing_typer = ModuleNotFoundError("No module named 'typer'")
        missing_typer.name = "typer"
        with (
            patch.object(cli, "_run_typer", side_effect=missing_typer),
            patch.object(cli, "_run_argparse_fallback", return_value=0) as mock_argparse,
        ):
            exit_code = cli.main(["--repo", "/tmp/repo", "--prompt", "Review"])

        self.assertEqual(exit_code, 0)
        mock_argparse.assert_called_once()


if __name__ == "__main__":
    unittest.main()
