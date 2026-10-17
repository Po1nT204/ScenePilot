export const durationLimits = { max: 900, fullGenerationMax: 300 } as const;
export function scriptGenerationOptions(seconds:unknown,model='yandexgpt-5.1') {
 if(!validDuration(seconds)) return null;
 if(seconds<=durationLimits.fullGenerationMax) return {maxTokens:'2000',timeoutMs:45000};
 return model==='yandexgpt-5.1' ? {maxTokens:'6000',timeoutMs:90000} : null;
}
export function validDuration(value: unknown): value is number {
 return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= durationLimits.max;
}
export function supportsFullGeneration(value: unknown): boolean {
 return validDuration(value) && value <= durationLimits.fullGenerationMax;
}
export const longGenerationMessage = 'Генерация полного сценария и сцен пока доступна для цели до 5 минут. Для длинного пилота вставьте текст вручную и используйте бесплатное разбиение на сцены; лимиты платного ответа ещё не увеличены.';
