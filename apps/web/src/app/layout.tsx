import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const sans = localFont({
  src: "./fonts/IBMPlexSans-Variable.ttf",
  weight: "100 700",
  display: "swap",
  variable: "--font-sans",
});

const mono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.ttf", weight: "400" },
    { path: "./fonts/IBMPlexMono-Medium.ttf", weight: "500" },
  ],
  display: "swap",
  variable: "--font-mono",
});

const serif = localFont({
  src: "./fonts/SourceSerif4-Variable.ttf",
  weight: "200 900",
  display: "swap",
  variable: "--font-serif",
});

export async function generateMetadata(): Promise<Metadata> { return process.env.SENTINEL_TEAM_MODE === "true" ? {
  title: "Solana Sentinel — Shared Wallet Monitor",
  description: "Private shared wallet monitoring and alerts. Read-only chain access; no signing or trading.",
  icons: { icon: [{ url: "/sentinel-icon.svg", type: "image/svg+xml" }], apple: "/sentinel-icon.svg" },
} : {
  title: "Solana Sentinel — Solana Agentic Trading Research Platform",
  description:
    "Paper-only Solana research and paper-trading terminal. Deterministic risk, historical signals, provenance, no live broadcast.",
}; }

export const viewport: Viewport = { themeColor: "#0c1117", colorScheme: "dark" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} ${serif.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
