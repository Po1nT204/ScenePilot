'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RetryPage({ reset }: { reset?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="button" disabled={pending} onClick={() => startTransition(() => {
    router.refresh();
    reset?.();
  })}>{pending ? 'Загружаем…' : 'Повторить загрузку'}</button>;
}
