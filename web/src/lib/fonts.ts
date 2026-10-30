import { Geist } from "next/font/google";

// Scoped to the marketing/login pages only (see those pages' usage) — the
// dashboard and guest invitation pages keep their own fonts, so this isn't
// wired into the root layout's body font-family.
export const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
