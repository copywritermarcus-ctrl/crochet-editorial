/**
 * Filename-safe slug: lowercased, non-alphanumerics collapsed to a single
 * hyphen, trimmed of leading/trailing hyphens, capped at `maxLength` without
 * splitting mid-word where avoidable.
 */
export function slugify(input: string, maxLength = 60): string {
  const base = input
    .normalize('NFKD')
    // Strip combining marks so accented characters slug to their base letter.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (base === '') return 'untitled';
  if (base.length <= maxLength) return base;

  const cut = base.slice(0, maxLength);
  // Prefer a word boundary, but never return almost nothing to honour it.
  const lastHyphen = cut.lastIndexOf('-');
  const trimmed = lastHyphen > maxLength / 2 ? cut.slice(0, lastHyphen) : cut;
  return trimmed.replace(/-+$/g, '') || 'untitled';
}
