import { Geist, Geist_Mono } from "next/font/google";

/**
 * Fonts for the team dashboard only. They are applied through className on the team root, so the
 * shared layout (and the research dashboard) keeps its own fonts.
 */
export const geist = Geist({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-geist", display: "swap" });
export const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });
