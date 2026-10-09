import type { ContestPreference } from './local-model';

export function isContestTouched(summary?: { solvedProblemCount: number; attemptedProblemCount: number }): boolean {
  return !!summary && (summary.solvedProblemCount > 0 || summary.attemptedProblemCount > 0);
}

/** Global spoiler default: every contest, only touched contests, or none. */
export type SpoilerDefault = 'all' | 'touched' | 'none';
export const SPOILER_DEFAULTS: readonly SpoilerDefault[] = ['all', 'touched', 'none'];

export function isSpoilerDefault(value: unknown): value is SpoilerDefault {
  return typeof value === 'string' && (SPOILER_DEFAULTS as readonly string[]).includes(value);
}

/**
 * A manual per-contest preference wins. Otherwise the global default applies:
 * `all` → every contest shows spoilers; `touched` → only contests touched by
 * the selected members do; `none` → no contest does.
 */
export function shouldShowSpoilers(
  mode: ContestPreference['spoiler_mode'] | undefined,
  touched: boolean,
  loaded = true,
  spoilerDefault: SpoilerDefault = 'touched',
): boolean {
  if (!loaded) return false;
  return mode ? mode === 'spoiler' : defaultSpoilerMode(touched, spoilerDefault) === 'spoiler';
}

/** The mode a contest would have without a manual preference. */
export function defaultSpoilerMode(touched: boolean, spoilerDefault: SpoilerDefault): ContestPreference['spoiler_mode'] {
  return spoilerDefault === 'all' || (spoilerDefault === 'touched' && touched) ? 'spoiler' : 'non_spoiler';
}

export function validatePreferences(value: unknown): ContestPreference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(p => !p || typeof p.contest_id !== 'string' || !p.contest_id || !['spoiler', 'non_spoiler'].includes(p.spoiler_mode))) throw new Error('Invalid contest spoiler preferences');
  if (new Set(value.map(p => p.contest_id)).size !== value.length) throw new Error('Duplicate contest spoiler preference');
  return value.map(p => ({contest_id: p.contest_id, spoiler_mode: p.spoiler_mode}));
}
