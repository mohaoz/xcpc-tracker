from __future__ import annotations

import hashlib
import random
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

try:
    import httpx
except ModuleNotFoundError:  # pragma: no cover - exercised only in partial local envs
    httpx = None


class CodeforcesApiError(RuntimeError):
    """Raised when the Codeforces API returns an error payload."""


@dataclass
class CodeforcesApiClient:
    base_url: str = "https://codeforces.com/api"
    timeout_seconds: float = 20.0
    api_key: str | None = None
    api_secret: str | None = None

    def _build_params(self, params: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key or not self.api_secret:
            return params

        signed = dict(params)
        signed["apiKey"] = self.api_key
        signed["time"] = int(time.time())

        rand = f"{random.randint(0, 999999):06d}"
        encoded = urlencode(sorted(signed.items()), doseq=True)
        digest = hashlib.sha512(
            f"{rand}/{encoded}#{self.api_secret}".encode("utf-8")
        ).hexdigest()
        signed["apiSig"] = f"{rand}{digest}"
        return signed

    async def get(self, method: str, params: dict[str, Any]) -> Any:
        if httpx is None:
            raise RuntimeError("httpx is required to call the live Codeforces API")
        url = f"{self.base_url}/{method}"
        request_params = self._build_params(params)
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.get(url, params=request_params)
            response.raise_for_status()
        payload = response.json()
        if payload.get("status") != "OK":
            raise CodeforcesApiError(payload.get("comment", "Unknown Codeforces API error"))
        return payload["result"]
