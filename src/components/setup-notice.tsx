import Link from "next/link";

export function SetupNotice() {
  return (
    <section className="setup-notice" aria-labelledby="setup-title">
      <h2 id="setup-title">Подключим ваше рабочее пространство</h2>
      <p>Supabase ещё не настроен. Вход и сохранение данных пока недоступны.</p>
      <ol>
        <li>Создайте проект Supabase по инструкции в README.</li>
        <li>Скопируйте <code>.env.example</code> в <code>.env.local</code>.</li>
        <li>Укажите Project URL и Publishable key, затем перезапустите приложение.</li>
      </ol>
      <p>Используйте публичный ключ <code>sb_publishable_…</code>. Секретный ключ и пароль базы здесь не нужны.</p>
      <Link className="text-link" href="/">На главную</Link>
    </section>
  );
}
