export default function ProjectsLoading() {
  return <section className="workspace-loading" aria-busy="true" aria-live="polite" role="status">
    <div className="loading-heading"><span className="loading-spinner" aria-hidden="true" /><h1>Открываем рабочее пространство</h1></div>
    <p>Загружаем ваши материалы…</p>
    <div className="loading-preview" aria-hidden="true"><span /><span /><span /></div>
  </section>;
}
