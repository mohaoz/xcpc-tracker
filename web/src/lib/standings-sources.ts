import type { CatalogSource } from './catalog';

export function isSafeExternalUrl(value?: string): boolean {
  try { return ['https:', 'http:'].includes(new URL(value ?? '').protocol); } catch { return false; }
}

export function findStandingsSource(sources: CatalogSource[]): CatalogSource | null {
  const valid = sources.filter(s => isSafeExternalUrl(s.url) && (
    s.kind === 'standings' || s.kind === 'ranking' ||
    (['xcpcio_board', 'board_xcpcio'].includes(s.provider) && s.kind === 'contest')
  ));
  return valid.find(s => s.is_default) ?? valid.find(s => s.provider === 'rankland') ?? valid[0] ?? null;
}
