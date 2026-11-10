import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Evidence AI · CCS Research Workspace",
  description:
    "Trace the evidence. Understand the uncertainty. A research workspace for responsible misinformation assessment and human review.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
