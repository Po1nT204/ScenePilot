'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AppNavigation() {
  const path = usePathname();
  const profiles = path === '/projects/channel';
  return <nav className="app-navigation" aria-label="Разделы приложения">
    <Link href="/projects" aria-current={!profiles ? 'page' : undefined}>Мои ролики</Link>
    <Link href="/projects/channel" aria-current={profiles ? 'page' : undefined}>Профили каналов</Link>
  </nav>;
}
