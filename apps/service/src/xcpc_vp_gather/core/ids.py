from __future__ import annotations

import uuid


PROJECT_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "xcpc-vp-gather")


def stable_id(*parts: str) -> str:
    return str(uuid.uuid5(PROJECT_NAMESPACE, "::".join(parts)))
