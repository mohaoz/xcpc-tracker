from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ProviderContext:
    provider_key: str
    browser_state_dir: str
    artifact_root: str
    now_iso: str


@dataclass(frozen=True)
class ProviderContestRef:
    provider_key: str
    provider_contest_id: str
    contest_url: str | None = None


@dataclass(frozen=True)
class ProviderProblemRef:
    provider_key: str
    provider_problem_id: str
    provider_contest_id: str
    problem_url: str | None = None


@dataclass(frozen=True)
class IdentityBindingRef:
    provider_key: str
    local_member_key: str
    provider_handle: str
    identity_binding_id: str | None = None


@dataclass(frozen=True)
class ContestProblemItem:
    provider_problem_id: str
    problem_code: str | None
    ordinal: str | None
    title: str
    official_url: str | None
    source_payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ContestSyncResult:
    provider_key: str
    provider_contest_id: str
    title: str
    official_url: str | None
    start_time: str | None
    end_time: str | None
    timezone: str | None
    problems: list[ContestProblemItem]
    source_payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class MemberProblemStatusItem:
    provider_problem_id: str
    status: str
    source_url: str | None
    source_payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class MemberProblemStatusSyncResult:
    provider_key: str
    provider_handle: str
    statuses: list[MemberProblemStatusItem]
    source_payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ProblemResourceBatchResult:
    provider_key: str
    item_count: int


@dataclass(frozen=True)
class SubmissionSyncResult:
    provider_key: str
    provider_contest_id: str
    submission_count: int

