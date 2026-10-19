export const libraryPageSize = 12;
export const librarySearchLimit = 120;
export function libraryQuery(query: { page?: string | string[]; q?: string | string[] }) {
  const raw = typeof query.page === 'string' ? query.page : '';
  const page = /^[1-9]\d{0,4}$/.test(raw) ? Number(raw) : 1;
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, librarySearchLimit) : '';
  return { page, search, offset: (page - 1) * libraryPageSize };
}
export function libraryURL(page: number, search: string) {
  const query = new URLSearchParams();
  if (search) query.set('q', search);
  if (page > 1) query.set('page', String(page));
  return `/projects${query.size ? `?${query}` : ''}`;
}
// ILIKE patterns have their own wildcard syntax; search input must stay literal.
export function librarySearchPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, character => `\\${character}`)}%`;
}
