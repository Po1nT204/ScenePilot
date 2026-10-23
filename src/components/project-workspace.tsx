import Link from "next/link";

type Section = "settings" | "scripts" | "scenes" | "video" | "publication" | "export";

// Pages pass only a version already checked against the current user's project.
export function ProjectWorkspace({ projectId, title, current, version }: {
  projectId: string;
  title: string;
  current: Section;
  version?: { id: string; version_number: number } | null;
}) {
  const base = `/projects/${projectId}`;
  const query = version ? `?version=${version.id}` : "";
  const sections: { id: Section; label: string; href: string; available: boolean }[] = [
    { id: "scripts", label: "Сценарий", href: `${base}/scripts${query}`, available: true },
    { id: "scenes", label: "Сцены", href: `${base}/scenes${query}`, available: !!version },
    { id: "video", label: "Видео", href: `${base}/video${query}`, available: !!version },
    { id: "publication", label: "Публикация", href: `${base}/publication${query}`, available: !!version },
    { id: "export", label: "Экспорт текстов", href: `${base}/export${query}`, available: !!version },
    { id: "settings", label: "Настройки", href: base + query, available: true },
  ];

  return <header className="project-workspace">
    <Link className="text-link" href="/projects">← Мои ролики</Link>
    <div className="workspace-heading">
      <h1 className="auth-title">{title}</h1>
      <p className="version-badge">{version ? `Версия ${version.version_number}` : "Сценарий не сохранён"}</p>
    </div>
    <nav className="workspace-tabs" aria-label="Материалы ролика">
      {sections.map(section => section.available
        ? <Link className={section.id === 'publication' ? 'workspace-utility-start' : undefined} key={section.id} href={section.href} aria-current={current === section.id ? "page" : undefined}>{section.label}</Link>
        : <span className={section.id === 'publication' ? 'workspace-utility-start' : undefined} key={section.id} aria-disabled="true" title="Сначала сохраните сценарий">{section.label}</span>)}
    </nav>
    <p className="workspace-context">{!version
      ? "Сохраните первый сценарий — затем можно перейти к озвучке и видео."
      : current === "settings"
        ? "Настройки общие для ролика. Их изменения попадут только в новые версии сценария."
        : current === 'scripts' ? 'Напишите текст или используйте генерацию. Каждое сохранение создаёт отдельную версию.'
        : current === 'scenes' ? 'Уточните сцены и визуальные промпты. Для видео можно использовать и сценарий без сцен.'
        : current === 'video' ? 'Сценарий → озвучка → кадры → анимация по желанию → MP4.'
        : current === 'publication' ? 'Подготовьте заголовок и описание для самостоятельной публикации на YouTube.'
        : 'Скачайте сохранённые тексты и промпты. Готовый MP4 находится в разделе «Видео».'}</p>
  </header>;
}
