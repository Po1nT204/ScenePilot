import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { SetupNotice } from "@/components/setup-notice";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Вход — ScenePilot" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (!getSupabaseConfig()) return <SetupNotice />;
  return (
    <>
      <p className="eyebrow">С ВОЗВРАЩЕНИЕМ</p>
      <h1 className="auth-title">Продолжим вашу историю</h1>
      <p className="auth-description">Войдите в своё рабочее пространство.</p>
      <AuthForm mode="login" />
    </>
  );
}
