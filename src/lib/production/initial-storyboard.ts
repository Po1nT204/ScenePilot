import { narrationPace, validNarrationPace } from '../narration';
import { normalizeNarration, validateNarration, type VideoShot } from './model';
import { stableSceneEditsPayload, type SceneEdit } from '../scene-editing';
import { storyboardLimit } from './timed-storyboard';

export function initialStoryboard(script: string, pace = narrationPace.default as number, scenes?: SceneEdit[]) {
  if (!validNarrationPace(pace)) throw new Error('Некорректный темп сохранённой версии.');
  const sourceScenes = scenes === undefined ? undefined : stableSceneEditsPayload(scenes);
  if (scenes !== undefined && (!sourceScenes || !sourceScenes.length)) throw new Error('Сначала сохраните заполненные сцены этой версии.');
  const parts = sourceScenes?.map(s => ({ text: normalizeNarration(s.narration), prompt: s.visual_prompt, id: s.id })) ?? [{text:validateNarration(script),prompt:'',id:undefined}];
  const text = validateNarration(parts.map(p => p.text).join(' '));
  const wordsPerShot = Math.max(1, Math.round(pace * 8 / 60));
  const shots: Omit<VideoShot,'id'>[] = [];
  let offset = 0;
  for (const part of parts) {
    // A scene already has an authored visual brief. Splitting its speech does
    // not produce new camera angles or consistent characters.
    if (sourceScenes) {
      shots.push({text:part.text,start:offset,end:offset+part.text.length,prompt:part.prompt,image:{state:'empty'},sourceSceneId:part.id});
      offset+=part.text.length+1;
      continue;
    }
    const words=[...part.text.matchAll(/\S+/gu)];
    for(let i=0;i<words.length;) {
      let end=Math.min(words.length,i+wordsPerShot);
      if(end<words.length) {
        for(let j=end;j>=i+Math.ceil(wordsPerShot*0.6);j--) if(/[.!?…]["'»”)]*$/u.test(words[j-1][0])) {end=j;break;}
      }
      const start=words[i].index!, stop=words[end-1].index!+words[end-1][0].length;
      const excerpt=part.text.slice(start,stop);
      // Keep the user's visual brief intact; add a fragment only when there is room.
      const prompt=part.prompt ? part.prompt + (part.prompt.length+excerpt.length+24<=1800 ? `\nNarration moment: ${excerpt}` : '')
        : `Landscape composition, no text or watermark. Depict this moment: ${excerpt}`.slice(0,1600);
      shots.push({text:excerpt,start:offset+start,end:offset+stop,prompt,image:{state:'empty'},sourceSceneId:part.id});
      if(shots.length>storyboardLimit) throw new Error(`Для текста получается больше ${storyboardLimit} кадров. Разделите выпуск на части.`);
      i=end;
    }
    offset+=part.text.length+1;
  }
  return {text,shots};
}
