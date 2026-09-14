// CF ranks: https://codeforces.com/blog/entry/59228
export function ratingClass(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '';
  const rating = Math.round(value);
  return 'rating--' + (rating < 1200 ? 'gray' : rating < 1400 ? 'green' : rating < 1600 ? 'cyan' : rating < 1900 ? 'blue' : rating < 2100 ? 'violet' : rating < 2400 ? 'orange' : rating < 3000 ? 'red' : 'legendary');
}
