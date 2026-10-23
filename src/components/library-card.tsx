import Link from 'next/link';
import { formatDuration } from '@/lib/narration';

type LibraryProject = {
  id: string; title: string; topic: string; genre: string; language: string;
  target_duration_seconds: number;
  script_versions: { id: string; version_number: number; scenes: { count: number }[] }[];
};

export function LibraryCard({ project }: { project: LibraryProject }) {
  const base = `/projects/${project.id}`;
  const version = project.script_versions[0];
  const query = version ? `?version=${version.id}` : '';
  const sceneCount = version?.scenes[0]?.count ?? 0;
  const openURL = `${base}/${version ? 'video' : 'scripts'}${query}`;
  return <article className="video-row">
    <div className="video-summary">
      <p className="video-meta">{project.language === 'ru' ? 'Русский' : 'Английский'} · Цель {formatDuration(project.target_duration_seconds)} · {project.genre}</p>
      <h2><Link href={openURL}>{project.title}</Link></h2>
      <p className="project-topic">{project.topic}</p>
      <p className="library-version">{version ? `Сценарий · версия ${version.version_number} · сцен: ${sceneCount}` : 'Новый ролик · сценария пока нет'}</p>
    </div>
    <div className="video-materials">
      <div className="material-links" role="group" aria-label={`Материалы ролика «${project.title}»`}>
        <Link className="button" href={openURL}>{version ? 'Открыть видео' : 'Написать сценарий'} <span aria-hidden="true">→</span></Link>
        {version && <Link className="text-button" href={`${base}/scripts${query}`}>Сценарий</Link>}
      </div>
      <details className="library-more">
        <summary>Материалы и настройки</summary>
        <div className="library-more-links">
          {version && <>
            <Link href={`${base}/scenes${query}`}>Сцены</Link>
            <Link href={`${base}/publication${query}`}>Заголовок и описание</Link>
            <Link href={`${base}/export${query}`}>Экспорт текстов</Link>
          </>}
          <Link href={base + query}>Настройки ролика</Link>
          <Link href={`${base}${query}#delete-project`} className="library-remove" aria-label={`Перейти к удалению ролика «${project.title}»`}>Удалить…</Link>
        </div>
      </details>
    </div>
  </article>;
}
