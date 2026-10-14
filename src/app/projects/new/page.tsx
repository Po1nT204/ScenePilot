import { ProjectForm } from "@/components/project-form";
import { SetupNotice } from "@/components/setup-notice";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { requireProjectUser } from "@/lib/projects/server";
export const metadata = { title: "Новый ролик — ScenePilot" };
export const dynamic = "force-dynamic";
export default async function NewProjectPage() {
 if (!getSupabaseConfig()) return <SetupNotice />;
 await requireProjectUser();
 return <section className="project-editor"><h1 className="auth-title">Новый ролик</h1><p className="auth-description">Укажите тему, язык и длительность. Эти настройки используются при создании сценария.</p><ProjectForm /></section>;
}
