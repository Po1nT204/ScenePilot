import Link from "next/link";

const steps = [
  { number: "01", title: "Задайте направление", text: "Тема, жанр, язык и стиль — отправная точка вашего будущего видео." },
  { number: "02", title: "Соберите историю", text: "Создавайте сценарий, редактируйте текст и возвращайтесь к сохранённым версиям." },
  { number: "03", title: "Продумайте сцены", text: "Описание кадра, визуальный промпт и текст озвучки в одной последовательности." },
];

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">Перейти к содержимому</a>
      <header className="header container">
        <Link className="brand" href="/" aria-label="ScenePilot — главная">
          <span className="brand-mark" aria-hidden="true">S<span>▸</span></span>
          ScenePilot
        </Link>
        <nav aria-label="Основная навигация">
          <a href="#workflow">Как это работает</a>
          <Link href="/projects">Мои проекты <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>

      <main id="main" className="container">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="dot" /> ПРОСТРАНСТВО ДЛЯ ВАШИХ ИСТОРИЙ</p>
            <h1 id="hero-title">Большое видео<br />начинается<br /><span>с одной идеи.</span></h1>
            <p className="intro">От первого замысла до последовательности сцен. Сценарий, визуальные промпты и текст озвучки — всё в одном проекте.</p>
            <a className="button" href="#workflow">Посмотреть процесс <span aria-hidden="true">↓</span></a>
          </div>
          <div className="storyboard" aria-label="Иллюстрация процесса: идея, сценарий, сцены">
            <div className="board-top"><span>ВАША СЛЕДУЮЩАЯ ИСТОРИЯ</span><span aria-hidden="true">● ● ●</span></div>
            <div className="frame-art" aria-hidden="true"><div className="sun" /><div className="hill hill-back" /><div className="hill hill-front" /><span className="frame-label">Всё начинается здесь</span><span className="frame-corner">01 / 03</span></div>
            <div className="board-bottom"><span>Идея</span><span aria-hidden="true">→</span><span>Сценарий</span><span aria-hidden="true">→</span><span>Сцены</span></div>
            <p className="board-caption">Одна история. Шаг за шагом.</p>
          </div>
        </section>

        <section id="workflow" className="workflow" aria-labelledby="workflow-title">
          <div className="section-heading"><p className="eyebrow">ОТ ЗАМЫСЛА К МАТЕРИАЛАМ</p><h2 id="workflow-title">Место для каждого шага</h2></div>
          <ol className="steps">
            {steps.map((step) => <li key={step.number}><span className="step-number" aria-hidden="true">{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></li>)}
          </ol>
          <p className="workflow-note">Сохраните сценарий и сцены, затем выгрузите материалы выбранной версии в TXT или Markdown.</p>
        </section>

        <section id="workspace" className="workspace" aria-labelledby="workspace-title">
          <div><p className="eyebrow">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</p><h2 id="workspace-title">Начните с идеи ролика</h2><p>Создайте проект, подготовьте сценарий и раскадровку.<br />Сохраняйте версии и возвращайтесь к своим материалам.</p></div>
          <Link className="button" href="/projects">Открыть проекты <span aria-hidden="true">↗</span></Link>
        </section>
      </main>
      <footer className="footer container"><span>ScenePilot</span><span>От идеи к сценам.</span></footer>
    </>
  );
}
