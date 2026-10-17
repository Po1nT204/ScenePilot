// Planning assumptions, not measured speech timing. No model or network calls.
export const narrationPace = { min: 80, max: 220, default: 140 } as const;
export function validNarrationPace(value: unknown): value is number {
 return typeof value === 'number' && Number.isInteger(value) && value >= narrationPace.min && value <= narrationPace.max;
}
export function narrationTarget(targetSeconds:number,pace:number) {
 if (!validNarrationPace(pace) || !Number.isInteger(targetSeconds) || targetSeconds < 1 || targetSeconds > 900) throw new Error('Invalid narration target');
 const words=Math.max(1,Math.round(targetSeconds*pace/60));
 return {pace,words,minWords:Math.max(1,Math.floor(words*90/100)),maxWords:Math.ceil(words*110/100)};
}
export function narrationDeviation(text:string,targetWords:number) {
 const words=countNarrationWords(text);
 const difference=words-targetWords;
 return {words,difference,percent:Math.round(difference/targetWords*100)};
}
export function countNarrationWords(text: string): number {
 return (text.match(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu) ?? []).length;
}
export function estimateNarration(text: string, targetSeconds: number, wordsPerMinute: number) {
 if (!Number.isInteger(wordsPerMinute) || wordsPerMinute < narrationPace.min || wordsPerMinute > narrationPace.max || !Number.isFinite(targetSeconds) || targetSeconds <= 0) throw new Error('Invalid timing assumptions');
 const words = countNarrationWords(text);
 const seconds = Math.ceil(words * 60 / wordsPerMinute);
 const targetWords = Math.round(targetSeconds * wordsPerMinute / 60);
 const fit = !words ? 'empty' : seconds < targetSeconds * 0.8 ? 'short' : seconds > targetSeconds * 1.2 ? 'long' : 'near';
 return { words, seconds, targetWords, fit };
}
export function formatDuration(seconds: number): string {
 const rounded = Math.max(0,Math.round(seconds));
 return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2,'0')}`;
}
export function compareNarration(script: string, narration: string) {
 return {
  scriptWords: countNarrationWords(script), narrationWords: countNarrationWords(narration),
  matches: script.replace(/\s/gu,'') === narration.replace(/\s/gu,''),
 };
}
