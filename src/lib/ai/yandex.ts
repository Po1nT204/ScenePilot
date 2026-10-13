import "server-only";
import { GenerationError, requestYandexScript, requestYandexScenes } from "./yandex-client";
import type { ScriptBrief } from "../scripts/test-generator";
export function yandexReady() {
 return process.env.YANDEX_GENERATION_ENABLED === "true" && !!process.env.YANDEX_API_KEY?.trim() && /^[a-zA-Z0-9_-]+$/.test(process.env.YANDEX_FOLDER_ID ?? "");
}
function getYandexConfig() {
 if (!yandexReady()) throw new GenerationError("Генерация Yandex выключена или не настроена. Следуйте инструкции в README.");
 const model = process.env.YANDEX_MODEL?.trim() || "yandexgpt-5.1";
 if (!["yandexgpt-5.1","yandexgpt-5-lite"].includes(model)) throw new GenerationError("Неизвестная модель. Используйте yandexgpt-5.1 или yandexgpt-5-lite.");
 return {apiKey:process.env.YANDEX_API_KEY!.trim(),folderId:process.env.YANDEX_FOLDER_ID!,model};
}

export async function generateYandexScript(brief: ScriptBrief) {
 return requestYandexScript(getYandexConfig(),brief);
}
export async function generateYandexScenes(content:string,brief:ScriptBrief) {
 return requestYandexScenes(getYandexConfig(),content,brief);
}
