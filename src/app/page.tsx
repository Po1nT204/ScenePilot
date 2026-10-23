import Link from "next/link";
import styles from "./landing.module.css";

const steps = [
  { title: "Сценарий", text: "Задайте тему и соберите историю." },
  { title: "Озвучка", text: "Создайте озвучку и послушайте результат." },
  { title: "Кадры", text: "Создайте изображения к вашей истории." },
  { title: "Анимация", text: "Добавьте готовые клипы из Flow или другого сервиса.", optional: true },
  { title: "Сборка", text: "Выберите субтитры и сохраните MP4." },
];

function FilmIllustration() {
  return (
    <figure className={styles.film}>
      <div className={styles.filmBody} aria-hidden="true">
        <div className={styles.filmHeader}><span>SCENEPILOT / STUDIO</span><span className={styles.format}>16:9</span></div>
        <div className={styles.preview}>
          <svg viewBox="0 0 640 360" fill="none" focusable="false">
            <defs>
              <linearGradient id="landing-sky" x2="0" y2="1"><stop stopColor="#c5b38b" /><stop offset="1" stopColor="#ede1bb" /></linearGradient>
              <linearGradient id="landing-river" x2="0" y2="1"><stop stopColor="#aab6a0" /><stop offset="1" stopColor="#d7d4af" /></linearGradient>
            </defs>
            <path fill="url(#landing-sky)" d="M0 0h640v360H0z" />
            <circle cx="446" cy="106" r="43" fill="#f6edce" />
            <path fill="#9ca88d" d="M0 202 106 101 191 187 284 95 419 215 553 131 640 195V360H0Z" />
            <path fill="#667f69" d="m0 235 129-91 148 113 111-83 121 82 131-86v190H0Z" />
            <path fill="#355947" d="M0 220c128-8 146 73 262 60s186-83 378-38v118H0Z" />
            <path fill="url(#landing-river)" d="M399 262c-30 18-146 24-133 47s113 13 154 51H224c-53-53 36-56 75-69s66-18 100-29Z" />
            <path fill="#1e3d32" d="M0 288c88-3 120 14 174 72H0Zm640-13c-80 8-123 39-158 85h158Z" />
            <path stroke="#f6edce" strokeOpacity=".45" d="M317 310h39m-67 6h25m17 22h53" />
          </svg>
          <span className={styles.previewTag}>01 / НАЧАЛО ИСТОРИИ</span>
          <p className={styles.previewTitle}>У каждой истории<br /><em>свой ритм.</em></p>
        </div>
        <div className={styles.timeline}>
          <div className={styles.ruler}><span>00:00</span><span>00:15</span><span>00:30</span></div>
          <div className={styles.clips}><span>01</span><span>02</span><span>03</span><span>04</span></div>
          <div className={styles.audioTrack}>
            {Array.from({ length: 52 }, (_, i) => <i key={i} style={{ height: `${6 + ((i * 7 + i % 3 * 5) % 19)}px` }} />)}
          </div>
          <div className={styles.playhead} />
        </div>
        <div className={styles.filmFooter}><span>История · Голос · Движение</span><span>MP4 ↗</span></div>
      </div>
      <figcaption>От отдельных материалов к цельной истории. Иллюстрация процесса.</figcaption>
    </figure>
  );
}

export default function Home() {
  return (
    <div className={styles.landing}>
      <a className="skip-link" href="#main">Перейти к содержимому</a>
      <header className={`${styles.header} container`}>
        <Link className="brand" href="/" aria-label="ScenePilot — главная">
          <span className="brand-mark" aria-hidden="true">S<span>▸</span></span>
          ScenePilot
        </Link>
        <nav aria-label="Основная навигация">
          <a className={styles.processLink} href="#workflow">Как это работает</a>
          <Link className={styles.libraryLink} href="/projects">Мои ролики <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>

      <main id="main" className="container" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span className={styles.dot} /> ВАША ЛИЧНАЯ ВИДЕОСТУДИЯ</p>
            <h1 id="hero-title">Ваша история.<br /><span>Теперь в видео.</span></h1>
            <p className={styles.intro}>Сценарий, голос, кадры и монтаж — в одном проекте. Пройдите путь от замысла до готового MP4 в своём темпе.</p>
            <Link className={`button ${styles.primary}`} href="/projects">Открыть мои ролики <span aria-hidden="true">↗</span></Link>
            <p className={styles.heroNote}>Начните новую историю или продолжите сохранённую.</p>
          </div>
          <FilmIllustration />
        </section>

        <section id="workflow" className={styles.workflow} aria-labelledby="workflow-title">
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>ОТ ИДЕИ ДО MP4</p><h2 id="workflow-title">Один ролик. Пять понятных шагов.</h2></div>
            <p>Вы управляете историей.<br />ScenePilot собирает материалы вместе.</p>
          </div>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className={styles.stepNumber} aria-hidden="true">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                {step.optional && <span className={styles.optional}>По желанию</span>}
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.channels} aria-labelledby="channels-title">
          <span className={styles.channelMark} aria-hidden="true"><i /><i /><i /></span>
          <div><h2 id="channels-title">Разные каналы. Ваш почерк.</h2><p>Сохраните аудиторию, стиль и требования в профиле — для следующих роликов.</p></div>
          <Link href="/projects/channel">Профили каналов <span aria-hidden="true">↗</span></Link>
        </section>
      </main>
      <footer className={`${styles.footer} container`}><span>ScenePilot</span><span>Ваша история задаёт направление.</span></footer>
    </div>
  );
}
