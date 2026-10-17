"use client";
import {useEffect,useRef,useState} from 'react';
import {saveShots} from '@/app/projects/[id]/scenes/[sceneId]/actions';
import {shotsPayload,shotLimits,type Shot} from '@/lib/shots';
import {compareNarration,estimateNarration,formatDuration,validNarrationPace} from '@/lib/narration';
import {sourceLabel} from '@/lib/export';

type DraftShot=Shot&{key:string};
const signature=(shots:Shot[])=>JSON.stringify(shots.map(({id,narration_excerpt,action,visual_prompt,duration_seconds,source})=>({id,narration_excerpt,action,visual_prompt,duration_seconds,source})));
const fields={narration_excerpt:'Фрагмент озвучки',action:'Действие в кадре',visual_prompt:'Визуальный промпт'} as const;
export function ShotEditor({projectId,versionId,sceneId,initial,narration,description,sceneSource,narrationSnapshot,otherCount,pace}:{projectId:string;versionId:string;sceneId:string;initial:Shot[];narration:string;description:string;sceneSource:string;narrationSnapshot?:string;otherCount:number;pace?:number}) {
 const [shots,setShots]=useState<DraftShot[]>(()=>initial.map((shot,i)=>({...shot,key:shot.id??`saved-${i}`})));
 const [baseline,setBaseline]=useState(()=>signature(initial));
 const [snapshot,setSnapshot]=useState(narrationSnapshot);
 const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const lock=useRef(false);
 const dirty=signature(shots)!==baseline;
 const stale=snapshot!==undefined && snapshot!==narration;
 const valid=shotsPayload(shots)!==null && otherCount+shots.length<=shotLimits.perVersion;
 const comparison=compareNarration(narration,shots.map(shot=>shot.narration_excerpt).join('\n'));
 const seconds=shots.reduce((sum,shot)=>sum+(Number.isFinite(shot.duration_seconds)?shot.duration_seconds:0),0);
 const reading=estimateNarration(narration,1,validNarrationPace(pace)?pace:140);
 useEffect(()=>{
  if(!dirty&&!busy) return;
  const unload=(event:BeforeUnloadEvent)=>event.preventDefault();
  const click=(event:MouseEvent)=>{if(event.target instanceof Element && event.target.closest('a[href]') && !window.confirm('Есть несохранённые кадры или незавершённое сохранение. Покинуть страницу?')){event.preventDefault();event.stopPropagation();}};
  window.addEventListener('beforeunload',unload);document.addEventListener('click',click,true);
  return ()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',click,true);};
 },[dirty,busy]);
 function focus(key:string,field='heading'){requestAnimationFrame(()=>document.getElementById(`shot-${key}-${field}`)?.focus());}
 function add(){
  if(lock.current || shots.length>=40 || otherCount+shots.length>=240) return;
  const key=crypto.randomUUID();
  setShots(previous=>[...previous,{key,narration_excerpt:'',action:'',visual_prompt:'',duration_seconds:5,source:'manual'}]);
  focus(key,'narration_excerpt');setMessage('Новый кадр ещё не сохранён.');
 }
 function move(index:number,direction:-1|1){
  if(lock.current || index+direction<0 || index+direction>=shots.length) return;
  const next=[...shots];[next[index],next[index+direction]]=[next[index+direction],next[index]];
  setShots(next);focus(shots[index].key);setMessage(signature(next)===baseline?'Восстановлен сохранённый порядок.':'Порядок изменён. Сохраните план.');
 }
 function remove(index:number){
  if(lock.current || !window.confirm(`Удалить кадр ${index+1}? Сохранённый план изменится после «Сохранить кадры». Истории восстановления нет.`)) return;
  const next=shots.filter((_,i)=>i!==index);setShots(next);setMessage('Кадр убран из черновика.');
  if(next.length) focus(next[Math.min(index,next.length-1)].key);else requestAnimationFrame(()=>document.getElementById('add-shot')?.focus());
 }
 async function save(){
  if(lock.current || !valid || (!dirty&&!stale)) return;
  if(!shots.length && !window.confirm('Удалить все сохранённые кадры этого эпизода? Восстановления нет.')) return;
  lock.current=true;setBusy(true);setMessage('Сохраняем кадры…');
  try{
   const result=await saveShots(projectId,versionId,sceneId,shotsPayload(shots),narration);
   if(result.error) setMessage(result.error);
   else {const saved=result.shots!;setShots(saved.map((shot,i)=>({...shot,key:shots[i].key})));setBaseline(signature(saved));setSnapshot(narration);setMessage('Кадры и порядок сохранены.');}
  }catch{setMessage('Сохранение не подтверждено. Правки остались в редакторе; проверьте соединение.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <div className="material-editor">
  <p className="editor-note">Источник эпизода: {sourceLabel(sceneSource)} · {shots.length}/40 кадров · {otherCount+shots.length}/240 в версии</p>
  <details className="editor-help"><summary>Озвучка и описание эпизода</summary><p>{description}</p><p className="project-full-topic">{narration}</p></details>
  {stale && <p role="alert" className="timing-warning">План требует сверки: озвучка эпизода изменилась. Проверьте фрагменты и сохраните кадры, чтобы подтвердить сверку.</p>}
  <p className="editor-note">План: {formatDuration(seconds)} · Озвучка эпизода ≈ {formatDuration(reading.seconds)} при {validNarrationPace(pace)?pace:140} слов/мин. Длительности кадров приблизительные.</p>
  {!!shots.length && <p className={comparison.matches?'editor-note':'timing-warning'}>{comparison.matches?'Фрагменты совпадают с озвучкой эпизода (без учёта пробелов).':'Фрагменты отличаются от озвучки эпизода: проверьте пропуски, повторы и порядок.'}</p>}
  <form className="auth-form" onSubmit={event=>{event.preventDefault();void save();}}>
   <div className="editor-actions"><button className="button" disabled={busy||!valid||(!dirty&&!stale)}>{busy?'Сохраняем…':'Сохранить кадры'}</button><button type="button" id="add-shot" className="text-button" disabled={busy||shots.length>=40||otherCount+shots.length>=240} onClick={add}>Добавить кадр</button></div>
   <p role="status" className="editor-note">{dirty?'Есть несохранённые изменения':initial.length||shots.length?'Сохранено':'Нет сохранённых кадров'} · Без автосохранения</p>
   <p role="status" className="form-message">{message}</p>
   {!shots.length && <p>Добавьте кадры: что показывать во время каждой части озвучки. Изображения и видео здесь не создаются.</p>}
   <fieldset disabled={busy}><div className="scene-grid">{shots.map((shot,index)=><section className="scene-card project-form" key={shot.key} aria-labelledby={`shot-${shot.key}-heading`}>
    <h3 id={`shot-${shot.key}-heading`} tabIndex={-1}>Кадр {index+1}</h3><p className="editor-note">Источник: {sourceLabel(shot.source)}</p>
    <div className="scene-card-actions"><button type="button" className="text-button" disabled={!index} aria-label={`Кадр ${index+1} выше`} onClick={()=>move(index,-1)}>↑ Выше</button><button type="button" className="text-button" disabled={index===shots.length-1} aria-label={`Кадр ${index+1} ниже`} onClick={()=>move(index,1)}>↓ Ниже</button><button type="button" className="danger-button" aria-label={`Удалить кадр ${index+1}`} onClick={()=>remove(index)}>Удалить</button></div>
    {(Object.keys(fields) as (keyof typeof fields)[]).map(field=><div key={field}><label htmlFor={`shot-${shot.key}-${field}`}>{fields[field]}</label><textarea id={`shot-${shot.key}-${field}`} required maxLength={field==='visual_prompt'?2000:1000} rows={3} value={shot[field]} onChange={event=>setShots(previous=>previous.map(item=>item.key===shot.key?{...item,[field]:event.target.value}:item))}/></div>)}
    <label htmlFor={`shot-${shot.key}-duration`}>Примерная длительность, секунд</label><input id={`shot-${shot.key}-duration`} type="number" min={1} max={60} step={1} required value={shot.duration_seconds||''} onChange={event=>setShots(previous=>previous.map(item=>item.key===shot.key?{...item,duration_seconds:Number(event.target.value)}:item))}/>
   </section>)}</div></fieldset>
   {!valid && <p role="status">Заполните все поля. Фрагмент и действие — до 1000 символов, промпт — до 2000; длительность — целое число 1–60. Не более 40 кадров в эпизоде и 240 в версии.</p>}
   {shots.length>2 && <button className="button" disabled={busy||!valid||(!dirty&&!stale)}>Сохранить кадры</button>}
  </form>
  <details className="editor-help"><summary>О плане кадров</summary><p>Кадры принадлежат этому эпизоду выбранной версии. Сохранение применяет весь список и порядок. Редактирование эпизода не удаляет кадры; изменение озвучки требует сверки. Истории правок нет. Работайте в одной вкладке на материал.</p><p>Кадр описывает отдельное изображение или действие. Несколько кадров могут составлять один эпизод. Промпты можно скопировать после сохранения на вкладке «Экспорт».</p></details>
 </div>;
}
