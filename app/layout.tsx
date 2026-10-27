import type { Metadata } from "next";
import { Inter, Koulen } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import "./astra.css";
import "./devday.css";
import "./devday-stage.css";
import { Fragment } from "react";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { PageBackground } from "./PageBackground";
import { TooltipProvider } from "@/components/ui/tooltip";

const outpostBody = Inter({
  preload: false,
  subsets: ["latin"],
  variable: "--font-outpost-body",
});

const outpostDisplay = Koulen({
  preload: false,
  subsets: ["latin"],
  variable: "--font-outpost-display",
  weight: "400",
});

export const metadata: Metadata = {
  title: {
    default: "Demo Queue",
    template: "%s | Demo Queue",
  },
  description: "Realtime queue and picker for demo nights",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Local design review uses only fixtures and never initializes a backend client.
  const previewOnly = process.env.NODE_ENV === "development" && process.env.DEMO_QUEUE_THEME_PREVIEW === "1";
  const Provider = previewOnly ? Fragment : ConvexClientProvider;
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${outpostBody.variable} ${outpostDisplay.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        {previewOnly ? null : <PageBackground />}
        <TooltipProvider>
          <Provider>{children}</Provider>
        </TooltipProvider>
      </body>
    </html>
  );
}
