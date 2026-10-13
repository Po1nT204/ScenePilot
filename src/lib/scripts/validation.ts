export const scriptLimit = 20000;
export function validateScript(value: FormDataEntryValue | null) {
 const content = typeof value === "string" ? value.trim() : "";
 if (!content) return { content, error: "Введите текст сценария." };
 if (content.length > scriptLimit) return { content, error: "Сценарий должен содержать не более 20 000 символов." };
 return { content, error: undefined };
}
export type ScriptState = { message: string; savedId?: string };
