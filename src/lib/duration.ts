export const durationLimits = { max: 900, fullGenerationMax: 300 } as const;
export function validDuration(value: unknown): value is number {
 return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= durationLimits.max;
}
export function supportsFullGeneration(value: unknown): boolean {
 return validDuration(value) && value <= durationLimits.fullGenerationMax;
}
export const longGenerationMessage = 'Генерация полного сценария и сцен пока доступна для цели до 5 минут. Для длинного пилота вставьте текст вручную и используйте бесплатное разбиение на сцены; лимиты платного ответа ещё не увеличены.';
