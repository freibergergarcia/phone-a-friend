"""phone-a-friend package."""

from importlib.metadata import PackageNotFoundError, version

from phone_a_friend.relay import DEFAULT_TIMEOUT_SECONDS, RelayError, relay

try:
    __version__ = version("phone-a-friend")
except PackageNotFoundError:
    __version__ = "0.1.0"

__all__ = ["DEFAULT_TIMEOUT_SECONDS", "RelayError", "__version__", "relay"]
