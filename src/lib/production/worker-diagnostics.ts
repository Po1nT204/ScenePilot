export type WorkerPhase = 'folder' | 'lock' | 'heartbeat' | 'read' | 'recover' | 'process';

export function workerFailure(error: unknown, phase: WorkerPhase) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const stage = { folder: 'папка материалов', lock: 'блокировка', heartbeat: 'запись состояния', read: 'чтение сборок', recover: 'восстановление сборки', process: 'обработка сборки' }[phase];
  const known: Record<string, string> = {
    EACCES: 'Нет доступа к папке материалов. Проверьте права и защиту папок Windows.',
    EPERM: 'Windows запретила доступ к файлу или проверку процесса. Проверьте защиту папок и другие запущенные экземпляры.',
    ENOSPC: 'На диске недостаточно свободного места.',
    ENOENT: 'Не найден файл сборки или папка материалов. Материалы не удалялись.',
    ENOTDIR: 'Путь материалов указывает на файл вместо папки.',
    EBUSY: 'Файл занят другой программой. Закройте её и повторите запуск.',
    WORKER_LOCK_BUSY: 'Блокировка принадлежит работающему процессу. Не удаляйте её: остановите прежний обработчик через Ctrl+C.',
    WORKER_LOCK_INVALID: 'Файл блокировки не содержит корректного PID. Запустите npm run video:doctor и сохраните его вывод для диагностики.',
    EEXIST: 'Восстановление блокировки занято. Повторите запуск; если ошибка остаётся, запустите npm run video:doctor.',
  };
  const hint = typeof code === 'string' && Object.hasOwn(known, code) ? `${code}: ${known[code]}`
    : error instanceof SyntaxError ? 'Некорректный JSON в файле сборки. Нужна проверка job.json; не удаляйте материалы.'
    : 'Не удалось выполнить этот этап. Запустите npm run video:doctor и пришлите его вывод. Ключи присылать не нужно.';
  return `Обработчик остановлен — ${stage}. ${hint}`;
}
