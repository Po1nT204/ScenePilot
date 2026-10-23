"use client";
import {useEffect,useRef,useState} from 'react';
import {generatePublication,savePublication} from '@/app/projects/[id]/publication/actions';
import {emptyPublication,publicationPayload,publicationLimits,type PublicationDraft} from '@/lib/publication';
import {sourceLabel} from '@/lib/export';

export function PublicationEditor({projectId,versionId,initial,yandexEnabled}: {projectId:string;versionId:string;initial:PublicationDraft|null;yandexEnabled:boolean}) {
 const [draft,setDraft] = useState<PublicationDraft>(initial ?? emptyPublication);
 const [baseline,setBaseline] = useState(JSON.stringify(initial ?? emptyPublication));
 const [busy,setBusy] = useState(false);
 const [message,setMessage] = useState('');
 const lock = useRef(false);
 const titleRef = useRef<HTMLInputElement>(null);
 const descriptionRef = useRef<HTMLTextAreaElement>(null);
 const dirty = JSON.stringify(draft) !== baseline;
 useEffect(() => {
  if (!dirty && !busy) return;
  const unload = (e:BeforeUnloadEvent) => e.preventDefault();
  const click = (e:MouseEvent) => {
   if (e.target instanceof Element && e.target.closest('a[href]') && !window.confirm('Есть несохранённые материалы или незавершённый запрос. Покинуть страницу?')) {e.preventDefault();e.stopPropagation();}
  };
  window.addEventListener('beforeunload',unload);document.addEventListener('click',click,true);
  return () => {window.removeEventListener('beforeunload',unload);document.removeEventListener('click',click,true);};
 },[dirty,busy]);

 async function run(mode:'test'|'yandex'|'save') {
  if (lock.current) return;
  if (mode === 'save' && (!dirty || !publicationPayload(draft))) return;
  if (mode === 'yandex' && !window.confirm('Отправить сохранённый сценарий и требования его версии в YandexGPT? Это платный запрос до 2000 токенов ответа. Он заменит заголовок, варианты и описание в редакторе. Сохранение выполняется отдельно.')) return;
  if (mode === 'test' && (draft.title || draft.description || draft.titles.length) && !window.confirm('Заменить текст в редакторе тестовым шаблоном? Сохранённые материалы изменятся только после сохранения.')) return;
  lock.current=true;setBusy(true);setMessage(mode === 'yandex' ? 'YandexGPT готовит заголовки и описание. Ожидание — до 45 секунд…' : 'Выполняем запрос…');
  try {
   if (mode === 'save') {
    const payload = publicationPayload(draft)!;
    const result = await savePublication(projectId,versionId,payload);
    if (result.error) setMessage(result.error);
    else {setDraft(payload);setBaseline(JSON.stringify(payload));setMessage('Материалы сохранены для этой версии. Они доступны в экспорте.');}
   } else {
    const result = await generatePublication(projectId,versionId,mode);
    if (result.material) {setDraft(result.material);setMessage(`Материалы готовы. Проверьте и сохраните текст.${result.tokens !== undefined ? ` Всего токенов: ${result.tokens}.` : ''}`);}
    else setMessage(result.error ?? 'Не удалось получить материалы.');
   }
  } catch {setMessage('Запрос не завершён. Текст остаётся в редакторе; проверьте сохранённые материалы перед повтором.');}
  finally {lock.current=false;setBusy(false);}
 }
 async function copy(field:'title'|'description') {
  try {await navigator.clipboard.writeText(draft[field]);setMessage(`${field === 'title' ? 'Заголовок скопирован' : 'Описание скопировано'}. Скопирован текущий текст редактора${dirty ? ', включая несохранённые правки' : ''}.`);}
  catch {const element = field === 'title' ? titleRef.current : descriptionRef.current;element?.focus();element?.select();setMessage('Копирование недоступно. Текст выделен: нажмите Ctrl+C (или ⌘C).');}
 }
 return <div className="publication-editor">
  <div className="scene-toolbar">
   <button type="button" className="text-button" disabled={busy || !yandexEnabled} onClick={() => run('yandex')}>Подготовить с YandexGPT · платно</button>
   <details className="editor-extra-actions"><summary>Тестовый шаблон</summary><button type="button" className="text-button" disabled={busy} onClick={() => run('test')}>Заполнить тестовым шаблоном · бесплатно</button></details>
  </div>
  <p className="field-hint">Можно написать текст вручную. Источник: {sourceLabel(draft.source)}.</p>
  {!yandexEnabled && <p className="field-hint">YandexGPT не подключён. Можно заполнить поля самостоятельно.</p>}
  <p role="status">{message}</p>
  <p className="editor-note">{dirty ? 'Есть несохранённые изменения' : initial || draft.title ? 'Нет несохранённых изменений' : 'Материалы ещё не сохранены'}</p>
  <form className="auth-form project-form" onSubmit={e => {e.preventDefault();void run('save');}}>
   <fieldset disabled={busy}>
    {!!draft.titles.length && <div className="publication-variants"><h3>Варианты заголовка</h3>{draft.titles.map((title,index) => <div key={index}>
     <label htmlFor={`publication-variant-${index}`}>Вариант {index+1}</label>
     <input id={`publication-variant-${index}`} value={title} required maxLength={publicationLimits.title} onChange={e => {setDraft(previous => ({...previous,titles:previous.titles.map((value,i) => i===index ? e.target.value : value)}));setMessage('');}} />
     <button className="text-button" type="button" disabled={!title.trim()} onClick={() => {setDraft(previous => ({...previous,title}));setMessage('Вариант выбран. Проверьте заголовок и сохраните материалы.');titleRef.current?.focus();}}>Использовать вариант {index+1}</button>
    </div>)}</div>}
    <label htmlFor="publication-title">Выбранный заголовок</label>
    <input id="publication-title" ref={titleRef} required maxLength={publicationLimits.title} value={draft.title} onChange={e => {setDraft(previous => ({...previous,title:e.target.value}));setMessage('');}} />
    <p className="field-hint">{draft.title.length} / {publicationLimits.title}. Можно отредактировать выбранный заголовок отдельно от вариантов.</p>
    <button type="button" className="text-button" disabled={!draft.title.trim()} onClick={() => copy('title')}>Скопировать заголовок</button>
    <label htmlFor="publication-description">Описание ролика</label>
    <textarea id="publication-description" ref={descriptionRef} rows={12} required maxLength={publicationLimits.description} value={draft.description} onChange={e => {setDraft(previous => ({...previous,description:e.target.value}));setMessage('');}} />
    <p className="field-hint">{draft.description.length} / {publicationLimits.description}. Скопируется текущий текст редактора; экспорт использует сохранённый.</p>
    <button type="button" className="text-button" disabled={!draft.description.trim()} onClick={() => copy('description')}>Скопировать описание</button>
    <button type="submit" className="button" disabled={!dirty || !publicationPayload(draft)}>{busy ? 'Выполняем запрос…' : 'Сохранить материалы'}</button>
   </fieldset>
  </form>
 </div>;
}
