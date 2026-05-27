"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";
import SignIn from "@/components/auth/SignIn";
import { useConvexAuth } from "convex/react";
import { getRuntimeMode } from "@/lib/runtime/mode";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <SignIn />;
  }

  return <>{children}</>;
}

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (getRuntimeMode() === "supabase" && convex) {
    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
  }

  if (getRuntimeMode() === "supabase") {
    return <>{children}</>;
  }

  if (!convex) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground text-sm">
          Convex is not configured.
        </div>
      </div>
    );
  }

  return (
    <ConvexAuthProvider client={convex}>
      <AuthGate>{children}</AuthGate>
    </ConvexAuthProvider>
  );
}
