import type { Metadata } from "next";
import { Inter, Koulen } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
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
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${outpostBody.variable} ${outpostDisplay.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <PageBackground />
        <TooltipProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
