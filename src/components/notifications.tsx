'use client';
import { Toaster } from 'sonner';

export function Notifications() {
  return <Toaster position="top-right" richColors closeButton visibleToasts={3} containerAriaLabel="Уведомления" />;
}
