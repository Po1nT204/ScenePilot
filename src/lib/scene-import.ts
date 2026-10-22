import { stableSceneEditsPayload, type SceneEdit } from './scene-editing';

// External text is data. Never trust supplied IDs, sources or database fields.
export function importSceneText(input: string): SceneEdit[] {
  if (!input.trim() || input.length > 80000) throw new Error('Вставьте текст сцен до 80 000 символов.');
  const text = input.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```$/, '');
  let rows: unknown;
  if (/^[\[{]/.test(text)) {
    try { const value = JSON.parse(text); rows = Array.isArray(value) ? value : value.scenes; }
    catch { throw new Error('Не удалось прочитать JSON сцен.'); }
  } else {
    const blocks = text.split(/^\s*(?:#{1,4}\s*)?(?:СЦЕНА|SCENE)\s+\d+[^\r\n]*$/gimu).filter(s => s.trim());
    rows = blocks.map((block, index) => {
      const fields = [...block.matchAll(/^\s*(Описание|Description|Визуальный промпт|Visual prompt|Озвучка|Narration)\s*:\s*/gimu)];
      if (fields.length !== 3) throw new Error(`Сцена ${index + 1}: нужны поля «Описание», «Визуальный промпт», «Озвучка».`);
      const row: Record<string, string> = {};
      fields.forEach((m, i) => {
        const key = /^(Описание|Description)$/iu.test(m[1]) ? 'description' : /^(Озвучка|Narration)$/iu.test(m[1]) ? 'narration' : 'visual_prompt';
        if (key in row) throw new Error(`Сцена ${index + 1}: поле повторяется.`);
        row[key] = block.slice(m.index! + m[0].length, fields[i + 1]?.index ?? block.length).trim();
      });
      return row;
    });
  }
  if (!Array.isArray(rows) || !rows.length) throw new Error('В тексте не найдены сцены.');
  const result = stableSceneEditsPayload(rows.map(row => ({ description: row?.description, visual_prompt: row?.visual_prompt, narration: row?.narration, source: 'manual' })));
  if (!result) throw new Error('Допустимо 1–12 сцен. В каждой нужны три непустых поля до 2000 символов.');
  return result;
}
