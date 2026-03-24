from __future__ import annotations

from ..config import ServiceConfig
from ..db.connection import connect_db
from .repository import Repository


def list_members(config: ServiceConfig, provider_key: str | None = None) -> list[dict]:
    with connect_db(config) as conn:
        repo = Repository(conn)
        rows = repo.list_identity_bindings(provider_key)
        return [
            {
                "identity_binding_id": str(row["id"]),
                "provider_key": str(row["provider_key"]),
                "local_member_key": str(row["local_member_key"]),
                "provider_handle": str(row["provider_handle"]),
                "display_name": row["display_name"],
                "binding_status": str(row["binding_status"]),
            }
            for row in rows
        ]
