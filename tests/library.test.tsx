import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { libraryQuery, libraryURL, librarySearchPattern, libraryPageSize } from '../src/lib/projects/library';
import { LibrarySearch, LibraryPagination } from '../src/components/library-controls';

test('library URLs bound offsets and reject ambiguous, negative and oversized page values', () => {
  for (const page of [undefined, '0', '-1', '1.5', '01', '1e5', '100000', ['2', '3']]) {
    assert.equal(libraryQuery({ page }).offset, 0);
  }
  assert.equal(libraryQuery({ page: '3' }).offset, 2 * libraryPageSize);
  assert.equal(libraryQuery({ q: ['a', 'b'] }).search, '');
  assert.equal(libraryQuery({ q: '  Кино  ' }).search, 'Кино');
  assert.equal(libraryQuery({ q: 'я'.repeat(130) }).search.length, 120);
});

test('literal search preserves percent, underscore, slash and PostgREST punctuation without becoming a filter', () => {
  assert.equal(librarySearchPattern('100%_\\'), '%100\\%\\_\\\\%');
  assert.equal(librarySearchPattern('a,b.(test)'), '%a,b.(test)%');
  const text = 'Кино & page=99 /?#';
  const link = new URL(libraryURL(2, text), 'http://localhost');
  assert.equal(link.pathname, '/projects');
  assert.equal(link.searchParams.get('q'), text); assert.equal(link.searchParams.get('page'), '2');
  assert.equal(libraryURL(1, ''), '/projects');
});

test('pagination preserves search, disables boundaries and does not show a redundant single page', () => {
  assert.equal(renderToStaticMarkup(<LibraryPagination page={1} search="" hasNext={false} />), '');
  const first = renderToStaticMarkup(<LibraryPagination page={1} search="cats" hasNext />);
  assert.match(first, /aria-disabled="true"/); assert.match(first, /href="\/projects\?q=cats&amp;page=2"/);
  const last = renderToStaticMarkup(<LibraryPagination page={2} search="cats" hasNext={false} />);
  assert.match(last, /href="\/projects\?q=cats"/); assert.doesNotMatch(last, /rel="next"/);
});

test('new search resets pagination with GET and safely displays user text', () => {
  const html = renderToStaticMarkup(<LibrarySearch search={'<script>"&'} />);
  assert.match(html, /method="get"/); assert.match(html, /action="\/projects"/);
  assert.doesNotMatch(html, /name="page"/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /maxlength="120"/i); assert.match(html, /Сбросить поиск/);
});
