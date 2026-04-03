import type { Metadata } from "next";
import "./globals.css";
import ConvexClientProvider from "./ConvexClientProvider";
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
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="h-full flex flex-col">
        <script dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`,
        }} />
        <ConvexClientProvider>
          <TabNav />
          <main className="flex-1 overflow-hidden">
            {children}
          </main>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
