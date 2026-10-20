export default function ProjectsLoading() {
  return <section className="project-editor" aria-busy="true" aria-live="polite">
    <h1 className="auth-title">Загружаем…</h1>
    <p>Получаем данные из Supabase. При сбое появится кнопка повторной загрузки.</p>
  </section>;
}
