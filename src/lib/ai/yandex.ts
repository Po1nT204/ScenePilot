import "server-only";
import { GenerationError, requestYandexScript } from "./yandex-client";
import type { ScriptBrief } from "../scripts/test-generator";
export function yandexReady() {
 return process.env.YANDEX_GENERATION_ENABLED === "true" && !!process.env.YANDEX_API_KEY?.trim() && /^[a-zA-Z0-9_-]+$/.test(process.env.YANDEX_FOLDER_ID ?? "");
}
export async function generateYandexScript(brief: ScriptBrief) {
 if (!yandexReady()) throw new GenerationError("Генерация Yandex выключена или не настроена. Следуйте инструкции в README.");
 const model = process.env.YANDEX_MODEL?.trim() || "yandexgpt-5.1";
 if (!["yandexgpt-5.1","yandexgpt-5-lite"].includes(model)) throw new GenerationError("Неизвестная модель. Используйте yandexgpt-5.1 или yandexgpt-5-lite.");
 return requestYandexScript({apiKey:process.env.YANDEX_API_KEY!.trim(),folderId:process.env.YANDEX_FOLDER_ID!,model},brief);
}
