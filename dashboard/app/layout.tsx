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
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased" style={{ fontFamily: 'var(--font-body)' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
