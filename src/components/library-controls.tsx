import Link from 'next/link';
import { librarySearchLimit, libraryURL } from '@/lib/projects/library';

export function LibrarySearch({ search }: { search: string }) {
  return <form action="/projects" method="get" className="library-search" role="search" aria-label="Поиск роликов">
    <div><label htmlFor="library-search">Название ролика</label><input id="library-search" name="q" type="search" defaultValue={search} key={search} maxLength={librarySearchLimit} placeholder="Найти в моей библиотеке" /></div>
    <button className="button secondary" type="submit">Найти</button>
    {search && <Link className="text-link" href="/projects">Сбросить поиск</Link>}
  </form>;
}
export function LibraryPagination({ page, search, hasNext }: { page: number; search: string; hasNext: boolean }) {
  if (page === 1 && !hasNext) return null;
  return <nav className="library-pagination" aria-label="Страницы библиотеки">
    {page > 1 ? <Link className="button secondary" href={libraryURL(page - 1, search)} rel="prev">← Назад</Link> : <span className="pagination-disabled" aria-disabled="true">← Назад</span>}
    <span aria-current="page">Страница {page}</span>
    {hasNext ? <Link className="button secondary" href={libraryURL(page + 1, search)} rel="next">Далее →</Link> : <span className="pagination-disabled" aria-disabled="true">Далее →</span>}
  </nav>;
}
