import { mkdir, readFile, writeFile, rename, readdir, open, unlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { type VideoJob, type VideoScope, type VideoOperation, planShots, validVoice, validateNarration, assetsReady, estimatedCost, hasVisual, createsImages, createsMaterials } from './model';
import { type ImageSelection, validImageSelection, selectedImageProvider } from './image-catalog';
import { imagePrompt, validVisualStyle } from './visual-style';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validJobId(id: string) { return uuid.test(id); }
export function productionRoot() {
  return resolve(process.env.SCENEPILOT_MEDIA_DIR || join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'ScenePilot', 'production'));
}
export function jobDirectory(id: string, root = productionRoot()) {
  if (!validJobId(id)) throw new Error('Некорректный идентификатор видео.');
  return join(root, id);
}
export async function atomicWrite(file: string, data: string | Uint8Array) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, data, { flag: 'wx' }); await rename(temp, file); }
  finally { await unlink(temp).catch(() => {}); }
}
export async function withLock<T>(file: string, run: () => Promise<T>): Promise<T> {
  await mkdir(resolve(file, '..'), { recursive: true });
  let handle;
  try { handle = await open(file, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let pid: number;
    try { pid = Number(await readFile(file, 'utf8')); } catch { throw new Error('Задача занята. Повторите действие позже.'); }
    // Never steal a live process lock, including another request in this process.
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Файл блокировки повреждён. Перезапустите приложение.');
    try { process.kill(pid, 0); throw new Error('Задача занята. Повторите действие позже.'); }
    catch (probe) { if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw probe; }
    // Reclamation is serialized, so two contenders cannot remove a newly acquired lock.
    const reclaim = `${file}.reclaim`;
    const guard = await open(reclaim, 'wx').catch(() => { throw new Error('Задача занята.'); });
    try {
      if (Number(await readFile(file, 'utf8')) !== pid) throw new Error('Задача занята.');
      await unlink(file);
      handle = await open(file, 'wx');
    } finally { await guard.close(); await unlink(reclaim).catch(() => {}); }
  }
  try { await handle.writeFile(String(process.pid)); return await run(); }
  finally { await handle.close(); await unlink(file).catch(() => {}); }
}
export async function readJob(id: string, root = productionRoot()): Promise<VideoJob> {
  const file = join(jobDirectory(id, root), 'job.json');
  if ((await stat(file)).size > 3 * 1024 * 1024) throw new Error('Файл задачи слишком велик.');
  const job = JSON.parse(await readFile(file, 'utf8')) as VideoJob;
  if (job.schema !== 1 || job.id !== id || !validJobId(job.ownerId) || !validJobId(job.projectId) || !validJobId(job.versionId)) throw new Error('Файл задачи повреждён.');
  return job;
}
export function assertScope(job: VideoJob, scope: VideoScope) {
  if (job.ownerId !== scope.ownerId || job.projectId !== scope.projectId || job.versionId !== scope.versionId) throw new Error('Видео не найдено или недоступно.');
}
export async function saveJob(job: VideoJob, root = productionRoot()) {
  job.updatedAt = new Date().toISOString(); job.revision++;
  await atomicWrite(join(jobDirectory(job.id, root), 'job.json'), JSON.stringify(job));
}
export async function listJobs(scope?: VideoScope, root = productionRoot()) {
  const entries = await readdir(root, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; });
  const jobs: VideoJob[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !validJobId(entry.name)) continue;
    const job = await readJob(entry.name, root);
    if (!scope || (job.ownerId === scope.ownerId && job.projectId === scope.projectId && job.versionId === scope.versionId)) jobs.push(job);
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function createJob(scope: VideoScope, input: { title: string; script: string; source: string; voiceId: string; imageProvider?: ImageSelection }, root = productionRoot()) {
  if (![scope.ownerId, scope.projectId, scope.versionId].every(validJobId) || !validVoice(input.voiceId)) throw new Error('Укажите корректный Voice ID ElevenLabs.');
  if (!validImageSelection(input.imageProvider ?? 'none')) throw new Error('Неизвестный модуль изображений.');
  const job: VideoJob = { schema: 1, id: randomUUID(), ...scope, ...input, imageProvider: input.imageProvider ?? 'none', text: validateNarration(input.script),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 0, status: 'draft', message: 'План сохранён. Проверьте описание каждого кадра.',
    shots: planShots(input.script).map(s => ({ ...s, id: randomUUID() })), audio: { state: 'empty' }, outputStale: false, attempts: [] };
  await mkdir(jobDirectory(job.id, root), { recursive: true }); await saveJob(job, root); return job;
}
export async function editJob(id: string, scope: VideoScope, revision: number, edit: (job: VideoJob) => void | Promise<void>, root = productionRoot()) {
  return withLock(join(jobDirectory(id, root), 'edit.lock'), async () => {
    const job = await readJob(id, root); assertScope(job, scope);
    if (job.revision !== revision) throw new Error('Видео изменилось. Обновите состояние перед действием.');
    if (job.status === 'queued' || job.status === 'running') throw new Error('Дождитесь завершения текущего действия.');
    await edit(job); await saveJob(job, root); return job;
  });
}
export function queueOperation(job: VideoJob, operation: VideoOperation, paidConfirmed: boolean) {
  if (!['generate', 'speech', 'replace', 'render', 'check'].includes(operation.kind)) throw new Error('Неизвестное действие.');
  if (operation.kind === 'render' && !assetsReady(job)) throw new Error('Сначала нужны озвучка, тайминги и изображение или клип для каждой сцены.');
  if (operation.kind === 'generate' || operation.kind === 'speech') {
    if (!job.audio.file && ['requesting', 'unknown'].includes(job.audio.state)) throw new Error('Результат запроса озвучки неизвестен. Проверьте биллинг ElevenLabs; для нового запроса создайте отдельную сборку.');
    if (operation.kind === 'generate' && job.shots.some(s => !hasVisual(s) && !s.image.pollingUrl && ['requesting', 'unknown'].includes(s.image.state))) throw new Error('Результат запроса изображения неизвестен. Новый запрос возможен только отдельной кнопкой замены кадра.');
  }
  const cost = estimatedCost(job, operation.kind, operation.shotId);
  if (createsImages(job, operation.kind) && selectedImageProvider(job) === 'none') throw new Error('Сначала выберите модуль изображений в этой сборке.');
  if (createsMaterials(job, operation.kind) && !paidConfirmed) throw new Error('Подтвердите запросы к выбранному сервису, включая бесплатную генерацию.');
  if (cost > 0 && (!paidConfirmed || !Number.isFinite(operation.budgetUSD) || operation.budgetUSD < cost || operation.budgetUSD > 10)) throw new Error('Подтвердите платные запросы и предел расходов от оценки до $10.');
  if (operation.kind === 'replace') {
    const shot = job.shots.find(s => s.id === operation.shotId)!;
    if (shot.image.pollingUrl || ['pending', 'requesting'].includes(shot.image.state)) throw new Error('Запрос этого кадра ещё не завершён. Сначала нажмите «Проверить задачи изображений»; новая генерация не запущена.');
    shot.image = { state: 'empty', file: shot.image.file, generatedPrompt: shot.image.generatedPrompt, provider: shot.image.provider };
  }
  job.operation = { ...operation, reservedUSD: 0 }; job.status = 'queued'; job.message = 'В очереди локального обработчика.';
}
export function selectImageProvider(job: VideoJob, selection: unknown) {
  if (!validImageSelection(selection)) throw new Error('Неизвестный модуль изображений.');
  if (job.status === 'queued' || job.status === 'running') throw new Error('Дождитесь завершения текущего действия.');
  job.imageProvider = selection;
  job.message = 'Модуль следующих изображений сохранён. Готовые файлы и озвучка сохранены; запросы не запускались.';
}
export function saveAppearance(job: VideoJob, style: unknown, subtitles: unknown) {
  if (!validVisualStyle(style) || typeof subtitles !== 'boolean') throw new Error('Некорректные настройки оформления.');
  if (job.status === 'queued' || job.status === 'running') throw new Error('Дождитесь завершения текущего действия.');
  if (job.shots.some(shot => imagePrompt(shot.prompt, style).length > 2000)) throw new Error('Описание со стилем превышает 2000 символов. Сократите длинные описания кадров.');
  if ((job.subtitlesEnabled ?? true) !== subtitles && job.output) job.outputStale = true;
  job.visualStyle = style; job.subtitlesEnabled = subtitles;
  job.message = 'Оформление сохранено. Субтитры изменятся при пересборке, стиль — при отдельной генерации изображения. Готовые материалы сохранены.';
}
export async function workerOnline(root = productionRoot()) {
  try { return Date.now() - (await stat(join(root, 'heartbeat'))).mtimeMs < 15000; } catch { return false; }
}
export function assetFile(job: VideoJob, file: string, root = productionRoot()) {
  const files = [job.audio.file, job.output, job.subtitles, ...job.shots.flatMap(s => [s.image.file, s.clip?.file])];
  if (!/^[0-9a-f-]+\.(mp3|jpg|png|mp4|srt)$/.test(file) || !files.includes(file)) throw new Error('Материал не найден.');
  return join(jobDirectory(job.id, root), file);
}
