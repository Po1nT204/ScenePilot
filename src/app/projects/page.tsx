import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from 'next/navigation';
import { LibrarySearch, LibraryPagination } from '@/components/library-controls';
import { libraryQuery, libraryPageSize, librarySearchPattern, libraryURL } from '@/lib/projects/library';
import { SetupNotice } from "@/components/setup-notice";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { requireProjectUser, projectError } from "@/lib/projects/server";

export const metadata: Metadata = { title: "Мои ролики — ScenePilot" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ deleted?: string; page?: string | string[]; q?: string | string[] }> }) {
  if (!getSupabaseConfig()) return <SetupNotice />;
  const { supabase, user } = await requireProjectUser();
  const query = await searchParams;
  const { page, search, offset } = libraryQuery(query);
  // One extra row tells us if another page exists. Never fetch all projects/texts.
  let request = supabase.from("projects")
    .select("id,title,topic,genre,language,target_duration_seconds,script_versions(id,version_number,scenes(count))")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .order("version_number", { referencedTable: "script_versions", ascending: false })
    .limit(1, { referencedTable: "script_versions" })
    .range(offset, offset + libraryPageSize);
  if (search) request = request.ilike('title', librarySearchPattern(search));
  const { data, error } = await request;
  if (!error && !data.length && page > 1) redirect(libraryURL(1, search));
  const projects = data?.slice(0, libraryPageSize) ?? [];
  const hasNext = (data?.length ?? 0) > libraryPageSize;

  return <section className="video-library" aria-labelledby="library-title">
    <div className="project-heading">
      <div><p className="eyebrow">БИБЛИОТЕКА</p><h1 id="library-title" className="auth-title">Мои ролики</h1>
        <p className="auth-description">Сценарии, сцены, тексты публикации и экспорт — открывайте нужный материал сразу.</p></div>
      {!error && <Link className="button" href="/projects/new">+ Новый ролик</Link>}
    </div>
    {query.deleted === "1" && <p className="success-notice" role="status">Проект и его облачные материалы удалены. Локальные файлы видео остаются на компьютере.</p>}
    <LibrarySearch search={search} />
    {error ? <section className="library-empty"><h2>Не удалось загрузить библиотеку</h2>
      <p role="alert">{["PGRST205", "42P01", "PGRST200"].includes(error.code)
        ? "Для библиотеки нужны таблицы проектов, версий и сцен. Проверьте миграции по инструкции в README."
        : projectError(error.code)}</p><Link className="text-link" href={libraryURL(page, search)}>Повторить загрузку</Link></section>
      : !projects.length && search ? <section className="library-empty"><h2>Ничего не найдено</h2><p>Нет роликов с «{search}» в названии. Измените запрос или вернитесь ко всем проектам.</p><Link className="text-link" href="/projects">Показать все ролики</Link></section>
      : !projects.length ? <section className="library-empty"><span className="library-empty-mark" aria-hidden="true">01</span>
        <h2>Добавьте первый ролик</h2><p>Задайте тему и параметры. Затем напишите сценарий или создайте его с помощью YandexGPT.</p>
        <Link className="button" href="/projects/new">Создать ролик</Link></section>
        : <>
          <p className="library-note">Показаны ролики {offset + 1}–{offset + projects.length}{search ? ` по запросу «${search}»` : ''}. Сначала — недавно изменённые. В карточке — последняя сохранённая версия сценария.</p>
          <div className="video-list">{projects.map(project => {
            const base = `/projects/${project.id}`;
            const version = project.script_versions[0];
            const sceneCount = version?.scenes[0]?.count ?? 0;
            const scriptUrl = version ? `${base}/scripts?version=${version.id}` : `${base}/scripts`;
            return <article className="video-row" key={project.id}>
              <div className="video-summary">
                <p className="video-meta">{project.language === "ru" ? "Русский" : "Английский"} · {project.target_duration_seconds} сек. · {project.genre}</p>
                <h2><Link href={scriptUrl}>{project.title}</Link></h2>
                <p className="project-topic">{project.topic}</p>
                <Link className="text-link video-settings" href={base}>Настройки ролика</Link>
                <Link className="text-link library-delete-link" href={`${base}#delete-project`} aria-label={`Перейти к удалению ролика «${project.title}»`}>Удаление…</Link>
              </div>
              <div className="video-materials">
                <p className="material-status">{version ? <>Версия {version.version_number}<span>Сохранённых сцен: {sceneCount}</span></> : <>Сценария пока нет<span>Начните с текста или генерации</span></>}</p>
                <div className="material-links" role="group" aria-label={`Материалы ролика «${project.title}»`}>
                  <Link className="button" href={scriptUrl}>{version ? "Сценарий" : "Создать сценарий"}</Link>
                  {version ? <>
                    <Link className="text-button" href={`${base}/scenes?version=${version.id}`}>{sceneCount ? "Сцены" : "Создать сцены"}</Link>
                    <Link className="text-button" href={`${base}/video?version=${version.id}`}>Видео</Link>
                    <Link className="text-button" href={`${base}/publication?version=${version.id}`}>Публикация</Link>
                    <Link className="text-button" href={`${base}/export?version=${version.id}`}>Экспорт</Link>
                  </> : <p className="material-hint">Сцены, тексты публикации и экспорт станут доступны после сохранения сценария.</p>}
                </div>
              </div>
            </article>;
          })}</div>
          <LibraryPagination page={page} search={search} hasNext={hasNext} />
        </>}
  </section>;
}
