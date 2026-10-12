import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { SignOutForm } from "@/components/sign-out-form";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Мои проекты — ScenePilot" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  if (!getSupabaseConfig()) {
    return <main className="auth-shell"><div className="auth-card"><SetupNotice /></div></main>;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error && (error.name === "AuthRetryableFetchError" || (error.status && error.status >= 500))) throw new Error("Auth service unavailable");
  if (!data.user) redirect("/login");

  return (
    <>
      <header className="header container">
        <Link className="brand" href="/">ScenePilot</Link>
        <SignOutForm />
      </header>
      <main className="container projects-page">
        <p className="eyebrow">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</p>
        <h1 className="auth-title">Мои проекты</h1>
        <p className="auth-description">Вы вошли как {data.user.email}.</p>
        <section className="workspace">
          <div>
            <h2>Место для вашей первой истории</h2>
            <p>Вход подключён. Создание и сохранение проектов появятся на следующем шаге.</p>
          </div>
        </section>
      </main>
    </>
  );
}
