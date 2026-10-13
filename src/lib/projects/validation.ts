export const projectLimits = { title: 120, topic: 4000, genre: 100, style: 100 } as const;
export type ProjectValues = { title: string; topic: string; genre: string; language: string; style: string; duration: string };
export const emptyProject: ProjectValues = { title: "", topic: "", genre: "", language: "ru", style: "", duration: "60" };
export type ProjectState = { message: string; values?: ProjectValues; errors?: Partial<Record<keyof ProjectValues, string>> };
export function validateProject(formData: FormData) {
 const values = Object.fromEntries(Object.keys(emptyProject).map((key) => {
  const value = formData.get(key);
  return [key, typeof value === "string" ? value.trim() : ""];
 })) as ProjectValues;
 const errors: NonNullable<ProjectState["errors"]> = {};
 for (const [field, max] of Object.entries(projectLimits)) {
  const key = field as keyof typeof projectLimits;
  if (!values[key] || values[key].length > max) errors[key] = "Введите от 1 до " + max + " символов.";
 }
 if (!["ru", "en"].includes(values.language)) errors.language = "Выберите русский или английский язык.";
 if (!/^\d+$/.test(values.duration) || Number(values.duration) < 1 || Number(values.duration) > 300) errors.duration = "Укажите целое число секунд от 1 до 300.";
 return { values, errors, valid: Object.keys(errors).length === 0,
  data: { title: values.title, topic: values.topic, genre: values.genre, language: values.language, style: values.style, target_duration_seconds: Number(values.duration) } };
}
export function isProjectId(value: unknown): value is string {
 return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
