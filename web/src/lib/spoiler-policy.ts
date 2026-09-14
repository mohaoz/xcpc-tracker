import type { ContestPreference } from './local-model';

export function isContestTouched(summary?: { solvedProblemCount: number; attemptedProblemCount: number }): boolean {
  return !!summary && (summary.solvedProblemCount > 0 || summary.attemptedProblemCount > 0);
}

export function shouldShowSpoilers(mode: ContestPreference['spoiler_mode'] | undefined, touched: boolean, loaded = true): boolean {
  if (!loaded) return false;
  return mode ? mode === 'spoiler' : touched;
}

export function validatePreferences(value: unknown): ContestPreference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(p => !p || typeof p.contest_id !== 'string' || !p.contest_id || !['spoiler', 'non_spoiler'].includes(p.spoiler_mode))) throw new Error('Invalid contest spoiler preferences');
  if (new Set(value.map(p => p.contest_id)).size !== value.length) throw new Error('Duplicate contest spoiler preference');
  return value.map(p => ({contest_id: p.contest_id, spoiler_mode: p.spoiler_mode}));
}
