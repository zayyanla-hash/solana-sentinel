import localFont from "next/font/local";

/**
 * Fonts for the team dashboard only. They are applied through className on the team root, so the
 * shared layout (and the research dashboard) keeps its own fonts. Geist and Geist Mono (SIL OFL, see
 * fonts/OFL-LICENSE.txt) are bundled so builds and dev servers never depend on fetching font files.
 */
export const geist = localFont({ src: "./fonts/Geist-Variable.woff2", weight: "100 900", variable: "--font-geist", display: "swap" });
export const geistMono = localFont({ src: "./fonts/GeistMono-Variable.woff2", weight: "100 900", variable: "--font-geist-mono", display: "swap" });
