export class VideoAccessError extends Error {
  constructor() { super('Не удалось проверить доступ через Supabase. Проверьте соединение приложения (в том числе VPN), затем повторите действие. Сохранённые материалы не изменены.'); }
}
