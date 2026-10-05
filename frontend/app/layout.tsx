import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import SettingsInitializer from "./components/SettingsInitializer";
import { AuthProvider } from "./context/AuthContext";
import AuthGuard from "./components/AuthGuard";
import UserDataInitializer from "./components/UserDataInitializer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GeoPilot",
  description:
    "GeoPilot turns natural-language requests into traceable geospatial analysis workflows and reusable map artifacts.",
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Runtime environment variables injected at container start */}
        <Script src="/runtime-env.js" strategy="beforeInteractive" />
        {/* Initialize persisted Agent and tool settings */}
        <SettingsInitializer />
        {/* Authentication context + guard */}
        <AuthProvider>
          <UserDataInitializer />
          <AuthGuard>
            {children}
          </AuthGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
