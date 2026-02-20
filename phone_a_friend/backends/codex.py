"""Codex backend implementation."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


from phone_a_friend.backends import BackendError, INSTALL_HINTS


class CodexBackendError(BackendError):
    """Raised when Codex backend execution fails."""


@dataclass(frozen=True)
class CodexBackend:
    """Backend adapter for `codex exec`."""

    name: str = "codex"
    allowed_sandboxes: frozenset[str] = frozenset({"read-only", "workspace-write", "danger-full-access"})

    def run(
        self,
        *,
        prompt: str,
        repo_path: Path,
        timeout_seconds: int,
        sandbox: str,
        model: str | None,
        env: dict[str, str],
    ) -> str:
        codex_bin = shutil.which("codex")
        if not codex_bin:
            raise CodexBackendError(
                f"codex CLI not found in PATH. Install it: {INSTALL_HINTS['codex']}"
            )

        with tempfile.TemporaryDirectory(prefix="phone-a-friend-") as tmpdir:
            output_path = Path(tmpdir) / "codex-last-message.txt"
            cmd = [
                codex_bin,
                "exec",
                "-C",
                str(repo_path),
                "--skip-git-repo-check",
                "--sandbox",
                sandbox,
                "--output-last-message",
                str(output_path),
            ]
            if model:
                cmd.extend(["-m", model])
            cmd.append(prompt)

            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=timeout_seconds,
                    env=env,
                )
            except subprocess.TimeoutExpired as exc:
                raise CodexBackendError(f"codex exec timed out after {timeout_seconds}s") from exc

            last_message = _read_output_file(output_path)
            if result.returncode != 0:
                detail = (result.stderr or result.stdout or last_message).strip()
                if not detail:
                    detail = f"codex exec exited with code {result.returncode}"
                raise CodexBackendError(detail)

            if last_message:
                return last_message

            fallback = (result.stdout or "").strip()
            if fallback:
                return fallback

        raise CodexBackendError("codex exec completed without producing feedback")


def _read_output_file(output_path: Path) -> str:
    if not output_path.exists():
        return ""
    try:
        return output_path.read_text().strip()
    except OSError as exc:
        raise CodexBackendError(f"Failed reading Codex output file: {exc}") from exc


CODEX_BACKEND = CodexBackend()
