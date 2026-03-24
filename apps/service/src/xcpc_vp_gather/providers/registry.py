from __future__ import annotations

from ..config import ServiceConfig
from .base import Provider
from .codeforces.api_client import CodeforcesApiClient
from .codeforces.provider import CodeforcesProvider


def build_provider_registry(config: ServiceConfig | None = None) -> dict[str, Provider]:
    api_client = CodeforcesApiClient(
        api_key=None if config is None else config.codeforces_api_key,
        api_secret=None if config is None else config.codeforces_api_secret,
    )
    provider = CodeforcesProvider(api_client=api_client)
    return {provider.provider_key: provider}
