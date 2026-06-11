import { useEffect } from "react";
import {
  createRootRoute,
  Outlet,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/lib/theme";
import { AuthContext, useAuthProvider } from "@/hooks/use-auth";
import { ToastProvider } from "@/components/ui/toast";
import "@/lib/i18n";
import appCss from "@/styles/app.css?url";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
    },
  },
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Vintra - Kelola usahamu, naik kelas!" },
      {
        name: "description",
        content:
          "Platform SaaS untuk bisnis modern Indonesia. Kelola HPP, POS, inventaris, absensi, dan laporan keuangan dalam satu platform.",
      },
      // PWA meta — required for iOS Safari to allow Add-to-Home-Screen
      // installation, which in turn unlocks Web Push (iOS only allows
      // push from installed PWAs, never from a Safari tab).
      { name: "theme-color", content: "#1a3fa8" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "Vintra" },
      { name: "mobile-web-app-capable", content: "yes" },
    ],
    links: [
      {
        rel: "icon",
        type: "image/png",
        href: "/favicon.png",
      },
      {
        rel: "apple-touch-icon",
        href: "/favicon.png",
      },
      // Web App Manifest. Without this, iOS won't accept the
      // Add-to-Home-Screen → installable → Web Push pipeline.
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
    scripts: [
      {
        children: `(function(){if(window.location.pathname==='/')return;var t=localStorage.getItem('jq-theme');var e=(t==='light'||t==='dark')?t:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');if(e==='dark')document.documentElement.classList.add('dark')})()`,
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  // Self-heal stale-chunk failures. When a deploy ships, the
  // content-hashed JS filenames change and the old ones are deleted.
  // A tab still on the old HTML shell that lazy-loads a route will
  // 404 on a missing chunk — Vite fires `vite:preloadError`. Reload
  // once to pick up the fresh shell + chunk names. Rate-limited via
  // sessionStorage so a genuine network fault can't loop reloads.
  useEffect(() => {
    function onPreloadError() {
      const key = "jq-chunk-reload-at";
      const last = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - last > 15_000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
      }
    }
    window.addEventListener("vite:preloadError", onPreloadError);
    return () =>
      window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);

  return (
    // suppressHydrationWarning on <html> + <body>: the pre-hydration
    // script above sets documentElement.classList.add('dark') from
    // localStorage before React mounts, so the className differs from
    // what was server-rendered. Without suppression, React bails the
    // whole tree (JUR-132).
    <html lang="id" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body
        suppressHydrationWarning
        className="min-h-screen overflow-x-hidden bg-gray-50 text-gray-900 antialiased dark:bg-gray-900 dark:text-gray-100"
      >
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <ToastProvider>
                <Outlet />
              </ToastProvider>
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthProvider();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}
