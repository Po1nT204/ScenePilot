import Link from 'next/link';

export function WorkspaceNext({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return <aside className="workspace-next" aria-label="Следующий шаг">
    <div><p className="eyebrow">ДАЛЬШЕ</p><p>{children}</p></div>
    <Link href={href} className="button">{title} <span aria-hidden="true">→</span></Link>
  </aside>;
}
