import type { Metadata } from "next";
import "./globals.css";
import { Notifications } from '@/components/notifications';

export const metadata: Metadata = {
  title: "ScenePilot — от идеи к сценам",
  description: "Рабочее пространство для сценариев и подготовки видеоконтента.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <body>{children}<Notifications /></body>
    </html>
  );
}
