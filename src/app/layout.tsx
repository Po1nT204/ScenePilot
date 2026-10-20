import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScenePilot — от идеи к сценам",
  description: "Рабочее пространство для сценариев и подготовки видеоконтента.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
