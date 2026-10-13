import { ProjectForm } from "@/components/project-form";
import { SetupNotice } from "@/components/setup-notice";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { requireProjectUser } from "@/lib/projects/server";
export const metadata = { title: "Новый проект — ScenePilot" };
export const dynamic = "force-dynamic";
export default async function NewProjectPage() {
 if (!getSupabaseConfig()) return <SetupNotice />;
 await requireProjectUser();
 return <section className="project-editor"><p className="eyebrow">ШАГ 01 · ИДЕЯ</p><h1 className="auth-title">Новый проект</h1><p className="auth-description">Опишите направление. Сценарий и сцены добавим следующими шагами.</p><ProjectForm /></section>;
}
