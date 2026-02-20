"""Gemini backend implementation."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from phone_a_friend.backends import BackendError, INSTALL_HINTS


class GeminiBackendError(BackendError):
    """Raised when Gemini backend execution fails."""


@dataclass(frozen=True)
class GeminiBackend:
    """Backend adapter for Google's ``gemini`` CLI.

    The Gemini CLI uses a different interface from Codex:
    - Non-interactive mode: ``gemini --prompt "<prompt>"``
    - Repo context: ``--include-directories <dir>`` (subprocess cwd also set)
    - Sandbox: ``--sandbox`` (boolean flag, on/off — both ``read-only`` and
      ``workspace-write`` map to sandbox enabled; ``danger-full-access`` disables it)
    - Output: captured from stdout (``--output-format text``)
    - Model: ``-m <model>``
    - Auto-approve: ``--yolo`` enables tool use (file edits) in headless mode;
      ``--sandbox`` already constrains scope.
    """

    name: str = "gemini"
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
        gemini_bin = shutil.which("gemini")
        if not gemini_bin:
            raise GeminiBackendError(
                f"gemini CLI not found in PATH. Install it: {INSTALL_HINTS['gemini']}"
            )

        cmd = [gemini_bin]
        # Gemini sandbox is boolean: on for read-only/workspace-write, off for full access.
        if sandbox != "danger-full-access":
            cmd.append("--sandbox")
        # Auto-approve tool actions (file edits) in headless mode.
        # --sandbox already constrains the scope of what can be modified.
        cmd.append("--yolo")
        cmd.extend(["--include-directories", str(repo_path)])
        cmd.extend(["--output-format", "text"])
        if model:
            cmd.extend(["-m", model])
        cmd.extend(["--prompt", prompt])

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout_seconds,
                env=env,
                cwd=repo_path,
            )
        except subprocess.TimeoutExpired as exc:
            raise GeminiBackendError(f"gemini timed out after {timeout_seconds}s") from exc

        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            if not detail:
                detail = f"gemini exited with code {result.returncode}"
            raise GeminiBackendError(detail)

        output = (result.stdout or "").strip()
        if output:
            return output

        raise GeminiBackendError("gemini completed without producing output")


GEMINI_BACKEND = GeminiBackend()
