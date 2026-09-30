import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/Toasts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Room Digital Twin",
  description: "Live digital twin, monitoring and control of the smart room",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Browser extensions (Grammarly, Dark Reader …) add attributes to <html>/<body>
    // before hydration. This only ignores attribute differences on these two elements.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
