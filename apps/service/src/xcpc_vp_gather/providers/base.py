from __future__ import annotations

from typing import Iterable, Protocol

from ..models import (
    ContestSyncResult,
    IdentityBindingRef,
    MemberProblemStatusSyncResult,
    ProblemResourceBatchResult,
    ProviderContestRef,
    ProviderContext,
    ProviderProblemRef,
    SubmissionSyncResult,
)


class Provider(Protocol):
    provider_key: str

    async def sync_contest(
        self, ctx: ProviderContext, ref: ProviderContestRef
    ) -> ContestSyncResult: ...

    async def sync_member_problem_status(
        self, ctx: ProviderContext, binding: IdentityBindingRef
    ) -> MemberProblemStatusSyncResult: ...

    async def fetch_problem_resources(
        self, ctx: ProviderContext, problems: Iterable[ProviderProblemRef]
    ) -> ProblemResourceBatchResult: ...

    async def sync_submissions(
        self, ctx: ProviderContext, contest: ProviderContestRef
    ) -> SubmissionSyncResult: ...
