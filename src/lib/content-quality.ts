// Local writing aids, not an AI call or a prediction of audience performance.
export const hookOptions = {
  question: { label: 'Интригующий вопрос', text: 'Начни с конкретного вопроса зрителя и объясни, почему ответ важен.' },
  contrast: { label: 'Ожидание и реальность', text: 'Начни с контраста между привычным ожиданием и тем, что действительно объясняет история. Не выдумывай сенсацию.' },
  moment: { label: 'Сразу в событие', text: 'Открой историю конкретным действием или решающим моментом, затем кратко дай необходимый контекст.' },
} as const;
export const retentionOptions = {
  explain: { label: 'Вопрос → пример → ответ', text: 'Каждый блок: новый вопрос, конкретный пример, частичный ответ и логичный переход. Не повторяй вступление.' },
  story: { label: 'Цель → препятствие → последствия', text: 'Развивай цель, препятствия и последствия решений. Каждый эпизод должен менять ситуацию, а не повторять её.' },
  compare: { label: 'Сравнение вариантов', text: 'Сравни варианты по одинаковым критериям на конкретных примерах; покажи цену выбора и ограничения.' },
} as const;
export const endingOptions = {
  answer: { label: 'Ответ на главный вопрос', text: 'Дай ответ на вопрос начала и один содержательный вывод; закрой обещанную интригу.' },
  action: { label: 'Практический следующий шаг', text: 'Выполни обещание начала и предложи один выполнимый следующий шаг, связанный с темой.' },
  reflection: { label: 'Вывод и вопрос зрителю', text: 'Заверши основную мысль, затем задай один конкретный вопрос зрителю без искусственного спора.' },
} as const;
export function qualityRecipe(hook: keyof typeof hookOptions, retention: keyof typeof retentionOptions, ending: keyof typeof endingOptions) {
  return `Начало: ${hookOptions[hook].text}\nУдержание: ${retentionOptions[retention].text}\nФинал: ${endingOptions[ending].text}\nБез пустых приветствий, затянутых повторов и обещаний, которых ролик не выполняет.`;
}
export function appendQualityRecipe(current: string, recipe: string, limit: number): { value: string; error?: string } {
  if (current.includes(recipe)) return { value: current, error: 'Эти требования уже добавлены.' };
  const value = [current.trim(), recipe].filter(Boolean).join('\n\n');
  if (value.length > limit) return { value: current, error: `Вместе с требованиями получится ${value.length} символов при лимите ${limit}. Сократите поле «Формат роликов»; прежний текст сохранён.` };
  return { value };
}
