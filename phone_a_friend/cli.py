#!/usr/bin/env python3
"""phone-a-friend command entrypoint (Typer with argparse fallback)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from phone_a_friend import __version__
from phone_a_friend.installer import install_hosts, uninstall_hosts, verify_backends
from phone_a_friend.relay import (
    DEFAULT_BACKEND,
    DEFAULT_SANDBOX,
    DEFAULT_TIMEOUT_SECONDS,
    RelayError,
    relay,
)


def _repo_root_default() -> Path:
    return Path(__file__).resolve().parent.parent


def _normalize_argv(argv: list[str]) -> list[str]:
    """Keep backward-compatible root relay flags while supporting subcommands."""
    if not argv:
        return argv
    first = argv[0]
    if first in {"relay", "install", "update", "uninstall", "-h", "--help", "--version"}:
        return argv
    if first.startswith("-"):
        return ["relay", *argv]
    return argv


def _print_result_lines(lines: list[str]) -> None:
    for line in lines:
        print(line)


def _styled_status(name: str, available: bool) -> str:
    mark = "\u2713" if available else "\u2717"
    status = "available" if available else "not found"
    try:
        import typer
        color = typer.colors.GREEN if available else typer.colors.RED
        return f"  {typer.style(mark, fg=color)} {name}: {status}"
    except ModuleNotFoundError:
        return f"  {mark} {name}: {status}"


def _styled_hint(text: str) -> str:
    try:
        import typer
        return f"    {typer.style(text, fg=typer.colors.YELLOW)}"
    except ModuleNotFoundError:
        return f"    {text}"


def _print_backend_availability() -> None:
    print("\nBackend availability:")
    for info in verify_backends():
        print(_styled_status(str(info["name"]), bool(info["available"])))
        if not info["available"] and info["hint"]:
            print(_styled_hint(f"Install: {info['hint']}"))


def _run_install(
    *,
    claude: bool,
    all_targets: bool,
    mode: str,
    force: bool,
    repo_root: Path,
    no_claude_cli_sync: bool,
) -> int:
    # Claude is the only install target in this repository.
    target = "all" if all_targets else "claude"
    _ = claude  # accepted for compatibility with prior command style
    lines = install_hosts(
        repo_root=repo_root,
        target=target,
        mode=mode,
        force=force,
        sync_claude_cli=not no_claude_cli_sync,
    )
    _print_result_lines(lines)
    _print_backend_availability()
    return 0


def _run_uninstall(
    *,
    claude: bool,
    all_targets: bool,
) -> int:
    target = "all" if all_targets else "claude"
    _ = claude
    lines = uninstall_hosts(target=target)
    _print_result_lines(lines)
    return 0


def _run_update(
    *,
    mode: str,
    repo_root: Path,
    no_claude_cli_sync: bool,
) -> int:
    """Update the installed Claude plugin by reinstalling with --force."""
    return _run_install(
        claude=True,
        all_targets=False,
        mode=mode,
        force=True,
        repo_root=repo_root,
        no_claude_cli_sync=no_claude_cli_sync,
    )


def _run_relay(
    *,
    to: str,
    repo: Path,
    prompt: str,
    context_file: Path | None,
    context_text: str | None,
    include_diff: bool,
    timeout: int,
    model: str | None,
    sandbox: str,
) -> int:
    feedback = relay(
        prompt=prompt,
        repo_path=repo,
        backend=to,
        context_file=context_file,
        context_text=context_text,
        include_diff=include_diff,
        timeout_seconds=timeout,
        model=model,
        sandbox=sandbox,
    )
    print(feedback)
    return 0


def _run_argparse_fallback(argv: list[str]) -> int:
    argv = _normalize_argv(argv)
    parser = argparse.ArgumentParser(prog="phone-a-friend")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    install_parser = sub.add_parser("install", help="Install Claude plugin")
    install_parser.add_argument("--claude", action="store_true", help="Install for Claude")
    install_parser.add_argument("--all", dest="all_targets", action="store_true", help="Alias for --claude")
    install_parser.add_argument(
        "--mode",
        choices=("symlink", "copy"),
        default="symlink",
        help="Installation mode (default: symlink)",
    )
    install_parser.add_argument("--force", action="store_true", help="Replace existing install target")
    install_parser.add_argument(
        "--repo-root",
        default=str(_repo_root_default()),
        help="Repository root path",
    )
    install_parser.add_argument(
        "--no-claude-cli-sync",
        action="store_true",
        help="Skip Claude plugin marketplace/install/enable sync",
    )

    update_parser = sub.add_parser("update", help="Update Claude plugin (equivalent to install --force)")
    update_parser.add_argument(
        "--mode",
        choices=("symlink", "copy"),
        default="symlink",
        help="Installation mode (default: symlink)",
    )
    update_parser.add_argument(
        "--repo-root",
        default=str(_repo_root_default()),
        help="Repository root path",
    )
    update_parser.add_argument(
        "--no-claude-cli-sync",
        action="store_true",
        help="Skip Claude plugin marketplace/install/enable sync",
    )

    uninstall_parser = sub.add_parser("uninstall", help="Uninstall Claude plugin")
    uninstall_parser.add_argument("--claude", action="store_true", help="Uninstall for Claude")
    uninstall_parser.add_argument("--all", dest="all_targets", action="store_true", help="Alias for --claude")

    relay_parser = sub.add_parser("relay", help="Relay prompt/context to backend")
    relay_parser.add_argument(
        "--to",
        choices=("codex", "gemini"),
        default=DEFAULT_BACKEND,
        help="Target backend",
    )
    relay_parser.add_argument(
        "--repo",
        default=str(Path.cwd()),
        help="Repository path sent to the target backend (default: current directory)",
    )
    relay_parser.add_argument(
        "--prompt",
        required=True,
        help="Prompt to relay",
    )
    context_group = relay_parser.add_mutually_exclusive_group()
    context_group.add_argument(
        "--context-file",
        help="Optional file with additional context appended to the prompt",
    )
    context_group.add_argument(
        "--context-text",
        help="Optional inline context text appended to the prompt",
    )
    relay_parser.add_argument(
        "--include-diff",
        action="store_true",
        help="Append `git diff` from --repo to the relayed prompt",
    )
    relay_parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Max relay runtime in seconds (default: {DEFAULT_TIMEOUT_SECONDS})",
    )
    relay_parser.add_argument(
        "--model",
        help="Optional model override",
    )
    relay_parser.add_argument(
        "--sandbox",
        choices=("read-only", "workspace-write", "danger-full-access"),
        default=DEFAULT_SANDBOX,
        help="Sandbox mode for relay execution",
    )

    args = parser.parse_args(argv)

    if args.command == "install":
        return _run_install(
            claude=args.claude,
            all_targets=args.all_targets,
            mode=args.mode,
            force=args.force,
            repo_root=Path(args.repo_root),
            no_claude_cli_sync=args.no_claude_cli_sync,
        )
    if args.command == "uninstall":
        return _run_uninstall(
            claude=args.claude,
            all_targets=args.all_targets,
        )
    if args.command == "update":
        return _run_update(
            mode=args.mode,
            repo_root=Path(args.repo_root),
            no_claude_cli_sync=args.no_claude_cli_sync,
        )

    return _run_relay(
        to=args.to,
        repo=Path(args.repo),
        prompt=args.prompt,
        context_file=Path(args.context_file) if args.context_file else None,
        context_text=args.context_text,
        include_diff=args.include_diff,
        timeout=args.timeout,
        model=args.model,
        sandbox=args.sandbox,
    )


def _run_typer(argv: list[str]) -> int:
    argv = _normalize_argv(argv)
    import typer

    def _version_callback(value: bool) -> None:
        if value:
            typer.echo(f"phone-a-friend {__version__}")
            raise typer.Exit()

    app = typer.Typer(
        help="Relay prompt/context to coding backends",
        no_args_is_help=True,
        add_completion=False,
    )

    @app.callback()
    def app_callback(
        version: bool = typer.Option(False, "--version", callback=_version_callback, is_eager=True, help="Show version and exit"),
    ) -> None:
        pass

    @app.command("relay")
    def relay_command(
        to: str = typer.Option(DEFAULT_BACKEND, "--to", help="Target backend (codex or gemini)"),
        repo: Path = typer.Option(Path.cwd(), "--repo", help="Repository path sent to target backend"),
        prompt: str = typer.Option(..., "--prompt", help="Prompt to relay"),
        context_file: Path | None = typer.Option(
            None,
            "--context-file",
            help="Optional file with additional context appended to the prompt",
        ),
        context_text: str | None = typer.Option(
            None,
            "--context-text",
            help="Optional inline context text appended to the prompt",
        ),
        include_diff: bool = typer.Option(
            False,
            "--include-diff",
            help="Append `git diff` from --repo to the relayed prompt",
        ),
        timeout: int = typer.Option(
            DEFAULT_TIMEOUT_SECONDS,
            "--timeout",
            help="Max relay runtime in seconds",
        ),
        model: str | None = typer.Option(None, "--model", help="Optional model override"),
        sandbox: str = typer.Option(
            DEFAULT_SANDBOX,
            "--sandbox",
            help="Sandbox mode (read-only, workspace-write, danger-full-access)",
        ),
    ) -> None:
        try:
            if context_file is not None and context_text and context_text.strip():
                raise RelayError("Use only one of --context-file or --context-text")
            exit_code = _run_relay(
                to=to,
                repo=repo,
                prompt=prompt,
                context_file=context_file,
                context_text=context_text,
                include_diff=include_diff,
                timeout=timeout,
                model=model,
                sandbox=sandbox,
            )
        except (RelayError, RuntimeError) as exc:
            typer.echo(str(exc), err=True)
            raise typer.Exit(1)
        raise typer.Exit(exit_code)

    @app.command("install")
    def install_command(
        claude: bool = typer.Option(False, "--claude", help="Install for Claude"),
        all_targets: bool = typer.Option(False, "--all", help="Alias for --claude"),
        mode: str = typer.Option("symlink", "--mode", help="Installation mode: symlink or copy"),
        force: bool = typer.Option(False, "--force", help="Replace existing install target"),
        repo_root: Path = typer.Option(_repo_root_default(), "--repo-root", help="Repository root path"),
        no_claude_cli_sync: bool = typer.Option(
            False,
            "--no-claude-cli-sync",
            help="Skip Claude plugin marketplace/install/enable sync",
        ),
    ) -> None:
        try:
            exit_code = _run_install(
                claude=claude,
                all_targets=all_targets,
                mode=mode,
                force=force,
                repo_root=repo_root,
                no_claude_cli_sync=no_claude_cli_sync,
            )
        except RuntimeError as exc:
            typer.echo(str(exc), err=True)
            raise typer.Exit(1)
        raise typer.Exit(exit_code)

    @app.command("update")
    def update_command(
        mode: str = typer.Option("symlink", "--mode", help="Installation mode: symlink or copy"),
        repo_root: Path = typer.Option(_repo_root_default(), "--repo-root", help="Repository root path"),
        no_claude_cli_sync: bool = typer.Option(
            False,
            "--no-claude-cli-sync",
            help="Skip Claude plugin marketplace/install/enable sync",
        ),
    ) -> None:
        try:
            exit_code = _run_update(
                mode=mode,
                repo_root=repo_root,
                no_claude_cli_sync=no_claude_cli_sync,
            )
        except RuntimeError as exc:
            typer.echo(str(exc), err=True)
            raise typer.Exit(1)
        raise typer.Exit(exit_code)

    @app.command("uninstall")
    def uninstall_command(
        claude: bool = typer.Option(False, "--claude", help="Uninstall for Claude"),
        all_targets: bool = typer.Option(False, "--all", help="Alias for --claude"),
    ) -> None:
        try:
            exit_code = _run_uninstall(
                claude=claude,
                all_targets=all_targets,
            )
        except RuntimeError as exc:
            typer.echo(str(exc), err=True)
            raise typer.Exit(1)
        raise typer.Exit(exit_code)

    app(prog_name="phone-a-friend", args=argv)
    return 0


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    try:
        return _run_typer(args)
    except ModuleNotFoundError as exc:
        if exc.name != "typer":
            raise
    try:
        return _run_argparse_fallback(args)
    except (RelayError, RuntimeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
