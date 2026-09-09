import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { NeuroStateProvider } from "@/lib/neuro-state";

export const metadata: Metadata = {
  title: "SYSTEM.ONCO — Research workspace",
  description: "A research workspace for multimodal brain MRI preparation, volumetric visualization, and server-side report synthesis.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#workspace">Skip to workspace</a><NeuroStateProvider>{children}</NeuroStateProvider></body></html>;
}
