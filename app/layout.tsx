import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trilha",
  description: "Do briefing a conceitos criativos, com caminhos de um catálogo editorial.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
