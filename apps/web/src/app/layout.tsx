import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-serif",
});

export async function generateMetadata(): Promise<Metadata> { return process.env.SENTINEL_TEAM_MODE === "true" ? {
  title: "Solana Sentinel — Shared Wallet Monitor",
  description: "Private shared wallet monitoring and alerts. Read-only chain access; no signing or trading.",
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
