"use client";
import { useActionState } from "react";
import { deleteProject } from "@/app/projects/actions";
import type { ProjectState } from "@/lib/projects/validation";
export function DeleteProjectForm({ id }: { id: string }) {
 const [state, action, pending] = useActionState(deleteProject.bind(null, id), { message: "" } as ProjectState);
 return <details className="delete-section"><summary>Удалить проект</summary>
  <p>Удаление необратимо. Проверьте, что нужные материалы сохранены.</p>
  <p>Локальные видео останутся на компьютере, но перестанут открываться из этого проекта. Перед удалением скачайте нужные MP4 и дождитесь завершения задач видео.</p>
  <form action={action}><label className="confirm-delete"><input type="checkbox" name="confirm" required disabled={pending} /> Подтверждаю удаление этого проекта</label>
   <button className="danger-button" disabled={pending}>{pending ? "Удаляем…" : "Удалить навсегда"}</button>
   <p className="form-message" role="status">{state.message}</p>
  </form>
 </details>;
}
