import type { LocalRuntimeSnapshot } from './local-model';
import { validatePreferences } from './spoiler-policy';

type Row = Record<string, unknown>;
const invalid = (path: string): never => { throw new Error(`成员备份格式不正确：${path}`); };
function object(value: unknown, path: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path);
  return value as Row;
}
function text(row: Row, key: string, path: string, optional = false): void {
  if (optional && row[key] === undefined) return;
  if (typeof row[key] !== 'string' || !(row[key] as string).trim()) invalid(`${path}.${key}`);
}
function timestamp(row: Row, key: string, path: string, nullable = false, optional = false): void {
  if ((nullable && row[key] === null) || (optional && row[key] === undefined)) return;
  text(row, key, path);
  if (!Number.isFinite(Date.parse(row[key] as string))) invalid(`${path}.${key}`);
}
function oneOf(row: Row, key: string, values: string[], path: string): void {
  if (!values.includes(row[key] as string)) invalid(`${path}.${key}`);
}
function rows(root: Row, key: string, primaryKey: string, check: (row: Row, path: string) => void): Row[] {
  if (!Array.isArray(root[key])) invalid(key);
  const seen = new Set<string>();
  return (root[key] as unknown[]).map((value, index) => {
    const path = `${key}[${index}]`, row = object(value, path);
    text(row, primaryKey, path);
    if (seen.has(row[primaryKey] as string)) invalid(`${path}.${primaryKey} 重复`);
    seen.add(row[primaryKey] as string);
    check(row, path);
    return row;
  });
}

// Validate the complete file before any IndexedDB writes. Extra metadata fields
// remain round-trippable; unknown snapshot versions are never guessed.
export function validateRuntimeSnapshot(value: unknown): asserts value is LocalRuntimeSnapshot {
  const root = object(value, 'JSON');
  if (root.schemaVersion !== 1 || root.exportKind !== 'local_runtime_snapshot') invalid('schemaVersion / exportKind');
  timestamp(root, 'exportedAt', 'JSON');
  const members = rows(root, 'members', 'memberId', (row, path) => {
    text(row, 'displayName', path); text(row, 'identityRevision', path, true);
    timestamp(row, 'createdAt', path); timestamp(row, 'updatedAt', path);
    timestamp(row, 'deletedAt', path, true, true);
  });
  const memberIds = new Set(members.map(row => row.memberId));
  const accounts = new Set<string>();
  const handles = rows(root, 'memberHandles', 'handleId', (row, path) => {
    for (const key of ['memberId', 'provider', 'handle']) text(row, key, path);
    text(row, 'identityRevision', path, true);
    if (!memberIds.has(row.memberId)) invalid(`${path}.memberId 不存在`);
    if (row.displayLabel !== undefined && row.displayLabel !== null && typeof row.displayLabel !== 'string') invalid(`${path}.displayLabel`);
    timestamp(row, 'createdAt', path); timestamp(row, 'updatedAt', path);
    timestamp(row, 'deletedAt', path, true, true);
    const account = JSON.stringify([row.provider, row.handle]);
    if (!row.deletedAt && accounts.has(account)) invalid(`${path} 平台账号重复`);
    if (!row.deletedAt) accounts.add(account);
  });
  const handleById = new Map(handles.map(row => [row.handleId, row]));
  const sources = rows(root, 'importSources', 'sourceRecordId', (row, path) => {
    oneOf(row, 'kind', ['catalog', 'codeforces_api', 'qoj_userscript_json', 'manual_entry'], path);
    text(row, 'label', path); timestamp(row, 'importedAt', path);
    object(row.rawMetaJson, `${path}.rawMetaJson`);
  });
  const sourceIds = new Set(sources.map(row => row.sourceRecordId));
  rows(root, 'memberProblemStatus', 'statusId', (row, path) => {
    for (const key of ['memberId', 'problemId', 'provider', 'sourceRecordId']) text(row, key, path);
    if (!memberIds.has(row.memberId)) invalid(`${path}.memberId 不存在`);
    if (!sourceIds.has(row.sourceRecordId)) invalid(`${path}.sourceRecordId 不存在`);
    oneOf(row, 'status', ['solved', 'attempted'], path);
    oneOf(row, 'matchMethod', ['provider_id', 'contest_ordinal', 'alias', 'manual'], path);
    timestamp(row, 'firstSeenAt', path); timestamp(row, 'lastSeenAt', path);
    if (row.handleId !== undefined) {
      text(row, 'handleId', path);
      const handle = handleById.get(row.handleId);
      if (!handle || handle.memberId !== row.memberId || handle.provider !== row.provider || row.provider === 'manual') invalid(`${path}.handleId 不匹配`);
    }
  });
  rows(root, 'syncRecords', 'syncId', (row, path) => {
    text(row, 'sourceRecordId', path);
    if (!sourceIds.has(row.sourceRecordId)) invalid(`${path}.sourceRecordId 不存在`);
    oneOf(row, 'adapter', ['catalog', 'codeforces_api', 'qoj_userscript', 'manual'], path);
    oneOf(row, 'status', ['running', 'succeeded', 'failed'], path);
    timestamp(row, 'startedAt', path); timestamp(row, 'finishedAt', path, true);
    object(row.summaryJson, `${path}.summaryJson`);
  });
  validatePreferences(root.contest_preferences);
  if (root.app_settings !== undefined && typeof object(root.app_settings, 'app_settings').allow_medal_estimates !== 'boolean') invalid('app_settings.allow_medal_estimates');
}
