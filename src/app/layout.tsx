import type { Metadata } from "next";
import "./globals.css";
import TabNav from "@/components/layout/TabNav";

export const metadata: Metadata = {
  title: "Forge",
  description: "Tasks, Email & CRM — your local command center",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full flex flex-col">
        <TabNav />
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </body>
    </html>
  );
}
