import type { Metadata } from "next";
import { Analytics } from '@vercel/analytics/react';
import "./globals.css";

export const metadata: Metadata = {
  title: "Sentry Content Terminal 🤖",
  description: "Pls Consume Content Here",
  keywords: ["Sentry", "monitoring", "error tracking", "performance", "blog", "youtube",],
  authors: [{ name: "Sentry Content Terminal" }],
  icons: {
    icon: [
      {
        url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>👽</text></svg>",
        type: "image/svg+xml",
      },
    ],
  },
  openGraph: {
    title: "Sentry Content Terminal 🤖",
    description: "Pls Consume Content Here",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/e3t4euO8T-267oIAQAu6jDQyK3nVivNm4I81.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/pxiKyp0ihIEF2isfFJXUdVNF.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="antialiased font-['VT323']">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
