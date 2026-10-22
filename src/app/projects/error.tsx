"use client";

import { RetryPage } from "@/components/retry-page";
import Link from "next/link";

export default function ProjectsError({ reset }: { reset: () => void }) {
  return (
    <div className="workspace-feedback">
      <section role="alert">
        <h1>Не получилось загрузить страницу</h1>
        <p>Проверьте соединение и попробуйте ещё раз.</p>
        <p className="video-muted">Если ошибка появилась после сохранения, сначала обновите страницу: изменения могли уже сохраниться.</p>
        <RetryPage reset={reset} />
        <p><Link className="text-link" href="/projects">К моим роликам</Link></p>
      </section>
    </div>
  );
}
