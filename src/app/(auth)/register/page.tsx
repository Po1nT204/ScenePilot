import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { SetupNotice } from "@/components/setup-notice";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Регистрация — ScenePilot" };
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  if (!getSupabaseConfig()) return <SetupNotice />;
  return (
    <>
      <p className="eyebrow">НОВАЯ ИСТОРИЯ</p>
      <h1 className="auth-title">Создайте аккаунт</h1>
      <p className="auth-description">Ваше пространство для работы над видео.</p>
      <AuthForm mode="register" />
    </>
  );
}
