import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { PageBackground } from "./PageBackground";

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
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <PageBackground />
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
