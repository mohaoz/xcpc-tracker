import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
export const normalizeTitle = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const unique = values => [...new Set(values)];
export async function atomicJson(path, value, pretty = true) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(value, null, pretty ? 2 : undefined) + '\n');
  await rename(temporary, path);
}
export function problemIdentity(url) {
  try {
    const u = new URL(url);
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    let m;
    if (u.hostname === 'codeforces.com' && (m = u.pathname.match(/^\/(?:gym|contest)\/(\d+)\/problem\/([A-Za-z0-9]+)\/?$/))) return `cf:${m[1]}:${m[2].toUpperCase()}`;
    if (u.hostname === 'codeforces.com' && (m = u.pathname.match(/^\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)\/?$/))) return `cf:${m[1]}:${m[2].toUpperCase()}`;
    if (['qoj.ac', 'www.qoj.ac'].includes(u.hostname) && (m = u.pathname.match(/^\/(?:contest\/\d+\/)?problem\/(\d+)\/?$/))) return `qoj:${m[1]}`;
    return null;
  } catch { return null; }
}
export function names(problem) {
  return unique([problem.title, ...(problem.aliases ?? []), ...(problem.sources ?? []).map(s => s.source_title)].filter(Boolean).map(normalizeTitle));
}
export async function download(url, path) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.download-${process.pid}`;
  await promisify(execFile)('curl', ['-fL', '--retry', '2', '--max-time', '60', '-sS', url, '-o', temporary]);
  await rename(temporary, path);
}
export async function parallel(items, action, limit = 6) {
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) await action(items[next++]);
  }));
}
