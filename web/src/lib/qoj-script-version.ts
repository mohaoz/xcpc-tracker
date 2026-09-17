export function compareScriptVersions(a: string, b: string): number {
  const valid = /^\d+\.\d+\.\d+$/;
  if (!valid.test(a) || !valid.test(b)) throw new Error('Invalid script version');
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
