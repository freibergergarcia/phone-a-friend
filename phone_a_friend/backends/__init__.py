"""Backend interface and registry for relay targets."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

INSTALL_HINTS: dict[str, str] = {
    "codex": "npm install -g @openai/codex",
    "gemini": "npm install -g @google/gemini-cli",
}


class BackendError(RuntimeError):
    """Base error for all backend execution failures."""


class RelayBackend(Protocol):
    """Contract each backend must implement."""

    name: str
    allowed_sandboxes: frozenset[str]

    def run(
        self,
        *,
        prompt: str,
        repo_path: Path,
        timeout_seconds: int,
        sandbox: str,
        model: str | None,
        env: dict[str, str],
    ) -> str: ...


@dataclass(frozen=True)
class BackendRegistration:
    """Backend metadata used by the relay core and CLI."""

    name: str
    backend: RelayBackend


def check_backends() -> dict[str, bool]:
    """Check which backend CLIs are available in PATH."""
    return {name: shutil.which(name) is not None for name in sorted(INSTALL_HINTS)}


def get_backend(name: str) -> RelayBackend:
    from phone_a_friend.backends.codex import CODEX_BACKEND
    from phone_a_friend.backends.gemini import GEMINI_BACKEND

    registry = {
        CODEX_BACKEND.name: CODEX_BACKEND,
        GEMINI_BACKEND.name: GEMINI_BACKEND,
    }
    try:
        return registry[name]
    except KeyError as exc:
        supported = ", ".join(sorted(registry))
        raise ValueError(f"Unsupported relay backend: {name}. Supported: {supported}") from exc
