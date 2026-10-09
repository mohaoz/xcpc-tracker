export function isSafeExternalUrl(value?: string): boolean {
  try { return ['https:', 'http:'].includes(new URL(value ?? '').protocol); } catch { return false; }
}
