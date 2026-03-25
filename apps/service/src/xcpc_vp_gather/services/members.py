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
                "updated_at": str(row["updated_at"]),
            }
            for row in rows
        ]


def list_member_people(config: ServiceConfig, provider_key: str | None = None) -> list[dict]:
    with connect_db(config) as conn:
        repo = Repository(conn)
        binding_rows = repo.list_identity_bindings(provider_key)
        count_rows = repo.list_member_status_counts(provider_key)

    counts_by_local_key = {
        str(row["local_member_key"]): {
            "solved_count": int(row["solved_count"] or 0),
            "tried_count": int(row["tried_count"] or 0),
        }
        for row in count_rows
    }

    grouped: dict[str, dict] = {}
    for row in binding_rows:
        local_member_key = str(row["local_member_key"])
        entry = grouped.setdefault(
            local_member_key,
            {
                "local_member_key": local_member_key,
                "display_name": row["display_name"] or local_member_key,
                "providers": set(),
                "binding_status": str(row["binding_status"]),
                "last_synced_at": str(row["updated_at"]),
                "handles": [],
                "solved_count": counts_by_local_key.get(local_member_key, {}).get("solved_count", 0),
                "tried_count": counts_by_local_key.get(local_member_key, {}).get("tried_count", 0),
            },
        )
        current_last_synced_at = str(row["updated_at"])
        if current_last_synced_at > entry["last_synced_at"]:
            entry["last_synced_at"] = current_last_synced_at
        entry["providers"].add(str(row["provider_key"]))
        entry["handles"].append(
            {
                "identity_binding_id": str(row["id"]),
                "provider_key": str(row["provider_key"]),
                "provider_handle": str(row["provider_handle"]),
                "display_name": row["display_name"],
                "binding_status": str(row["binding_status"]),
                "updated_at": str(row["updated_at"]),
            }
        )

    people = []
    for key in sorted(grouped):
        item = grouped[key]
        people.append(
            {
                "local_member_key": item["local_member_key"],
                "display_name": item["display_name"],
                "provider_count": len(item["providers"]),
                "binding_count": len(item["handles"]),
                "binding_status": item["binding_status"],
                "solved_count": item["solved_count"],
                "tried_count": item["tried_count"],
                "last_synced_at": item["last_synced_at"],
                "handles": sorted(
                    item["handles"],
                    key=lambda handle: (handle["provider_key"], handle["provider_handle"]),
                ),
            }
        )
    return people
