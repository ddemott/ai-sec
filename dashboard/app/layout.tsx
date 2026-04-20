import type { Metadata } from "next";
import "./globals.css";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Secretary HQ",
  description: "AI-powered receptionist for service businesses",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="navy" className="dark">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {/* Inline critical theme to prevent white flash before React hydrates */}
        <style dangerouslySetInnerHTML={{ __html: `
          html { background-color: #090E1A; color: #E8F0FF; }
        ` }} />
        {/* Apply saved theme before React loads */}
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var t = localStorage.getItem('theme');
            if (t) document.documentElement.setAttribute('data-theme', t);
          } catch(e) {}
        ` }} />
      </head>
      <body className="antialiased" style={{ fontFamily: 'var(--font-body)' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
