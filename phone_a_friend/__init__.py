"""phone-a-friend package."""

import re
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from phone_a_friend.relay import DEFAULT_TIMEOUT_SECONDS, RelayError, relay

try:
    __version__ = version("phone-a-friend")
except PackageNotFoundError:
    # Source checkout fallback: read from pyproject.toml
    try:
        _pyproject = Path(__file__).resolve().parent.parent / "pyproject.toml"
        _match = re.search(r'^version\s*=\s*"([^"]+)"', _pyproject.read_text(), re.M)
        __version__ = _match.group(1) if _match else "unknown"
    except Exception:
        __version__ = "unknown"

__all__ = ["DEFAULT_TIMEOUT_SECONDS", "RelayError", "__version__", "relay"]
