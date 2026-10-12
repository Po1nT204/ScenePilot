"use client";

import Link from "next/link";

export default function ProjectsError({ reset }: { reset: () => void }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Не удалось открыть пространство</h1>
        <p className="auth-description">Сервис временно недоступен. Проверьте интернет и попробуйте ещё раз.</p>
        <button className="button" onClick={reset}>Повторить</button>
        <p><Link className="text-link" href="/">На главную</Link></p>
      </section>
    </main>
  );
}
