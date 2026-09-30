import type { LocalImportSourceRecord, LocalMemberHandleRecord, LocalMemberProblemStatusRecord } from './local-model';

export function accountStatusId(memberId: string, problemId: string, handleId: string): string {
  return `account:${JSON.stringify([memberId, problemId, handleId])}`;
}

// Old releases kept only one status per member/problem/provider. Attribute the
// surviving evidence only when its source identifies an account; never guess.
export function statusHandleId(
  status: LocalMemberProblemStatusRecord,
  handles: LocalMemberHandleRecord[],
  sources: Map<string, LocalImportSourceRecord> = new Map(),
): string | undefined {
  if (status.provider === 'manual') return undefined;
  if (status.handleId) return status.handleId;
  const candidates = handles.filter(h => h.memberId === status.memberId && h.provider === status.provider);
  const sourceHandle = sources.get(status.sourceRecordId)?.rawMetaJson?.handle;
  const matches = candidates.filter(h => typeof sourceHandle === 'string'
    ? h.handle === sourceHandle
    : status.sourceRecordId?.startsWith(`${h.provider}:${h.handle}:`));
  return matches.length === 1 ? matches[0].handleId : undefined;
}

export function withStatusProvenance(
  status: LocalMemberProblemStatusRecord,
  handles: LocalMemberHandleRecord[],
  sources: Map<string, LocalImportSourceRecord>,
): LocalMemberProblemStatusRecord {
  const handleId = statusHandleId(status, handles, sources);
  return handleId ? { ...status, handleId, statusId: accountStatusId(status.memberId, status.problemId, handleId) } : status;
}
