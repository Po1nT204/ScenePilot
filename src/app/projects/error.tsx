"use client";

import { RetryPage } from "@/components/retry-page";
import Link from "next/link";

export default function ProjectsError({ reset }: { reset: () => void }) {
  return (
    <div className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Не удалось открыть пространство</h1>
        <p className="auth-description">Не удалось получить данные из Supabase. Проверьте соединение и повторите загрузку. Сбой загрузки после сохранения не означает, что сохранение не состоялось.</p>
        <RetryPage reset={reset} />
        <p><Link className="text-link" href="/">На главную</Link></p>
      </section>
    </div>
  );
}
