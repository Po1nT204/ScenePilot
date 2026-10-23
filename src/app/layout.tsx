import type { Metadata } from "next";
import "./globals.css";
import { Notifications } from '@/components/notifications';

export const metadata: Metadata = {
  title: "ScenePilot — от идеи до готового видео",
  description: "Личная видеостудия: сценарий, озвучка, кадры и сборка MP4 в одном проекте.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <body>{children}<Notifications /></body>
    </html>
  );
}
