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
    { id: "settings", label: "Настройки", href: base + query, available: true },
    { id: "scripts", label: "Сценарий", href: `${base}/scripts${query}`, available: true },
    { id: "scenes", label: "Сцены", href: `${base}/scenes${query}`, available: !!version },
    { id: "video", label: "Видео", href: `${base}/video${query}`, available: !!version },
    { id: "publication", label: "Публикация", href: `${base}/publication${query}`, available: !!version },
    { id: "export", label: "Экспорт", href: `${base}/export${query}`, available: !!version },
  ];

  return <header className="project-workspace">
    <Link className="text-link" href="/projects">← Мои ролики</Link>
    <div className="workspace-heading">
      <h1 className="auth-title">{title}</h1>
      <p className="version-badge">{version ? `Версия ${version.version_number}` : "Сценарий не сохранён"}</p>
    </div>
    <nav className="workspace-tabs" aria-label="Материалы ролика">
      {sections.map(section => section.available
        ? <Link key={section.id} href={section.href} aria-current={current === section.id ? "page" : undefined}>{section.label}</Link>
        : <span key={section.id} aria-disabled="true" title="Сначала сохраните сценарий">{section.label}</span>)}
    </nav>
    <p className="workspace-context">{!version
      ? "Сохраните первый сценарий, чтобы открыть сцены, видео, материалы публикации и экспорт."
      : current === "settings"
        ? "Настройки общие для ролика. Их изменения попадут только в новые версии сценария."
        : "Сцены, материалы публикации и экспорт относятся к указанной сохранённой версии. История версий доступна в разделе «Сценарий»."}</p>
  </header>;
}
