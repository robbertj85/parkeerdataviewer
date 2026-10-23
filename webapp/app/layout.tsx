import type { Metadata } from "next";
import Script from "next/script";
import "leaflet/dist/leaflet.css";
import "./globals.css";

// Self-hosted Umami (prototype.transportlab.app); unset locally = no analytics.
const UMAMI_SRC = process.env.NEXT_PUBLIC_UMAMI_SRC;
const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

export const metadata: Metadata = {
  title: "Parkeerdataviewer - Parkeerbezetting Nederland",
  description: "Real-time parkeerbezetting van parkeergarages in Nederland. Bekijk beschikbaarheid, bezettingsgraad en historische data van het NPR/RDW netwerk.",
  keywords: ["parkeren", "parkeergarage", "Nederland", "bezetting", "NPR", "RDW", "real-time"],
  authors: [{ name: "Parkeerdataviewer" }],
  openGraph: {
    title: "Parkeerdataviewer - Parkeerbezetting Nederland",
    description: "Real-time parkeerbezetting van parkeergarages in Nederland",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover" />
      </head>
      <body className="antialiased">
        {children}
        {UMAMI_SRC && UMAMI_WEBSITE_ID && (
          <Script src={UMAMI_SRC} data-website-id={UMAMI_WEBSITE_ID} strategy="afterInteractive" />
        )}
      </body>
    </html>
  );
}
