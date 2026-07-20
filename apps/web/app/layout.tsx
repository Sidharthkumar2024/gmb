import type { Metadata } from "next";
import "../src/globals.css";
import { I18nProvider } from "../src/i18n/I18nProvider";

export const metadata: Metadata = {
  title: "NexaFlow AI",
  description: "AI-powered WhatsApp marketing & automation platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // lang/dir are seeded to the default here and updated client-side by the
  // I18nProvider once the saved locale hydrates (incl. RTL for ar/ur).
  return (
    <html lang="en" dir="ltr" className="h-full bg-[#f4f1e9]">
      <head>
        {/* Adgrowly editorial type system */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full bg-[#f4f1e9] text-[#1f1d17] antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
