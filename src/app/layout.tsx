import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "react-hot-toast";
import { SplashScreen } from "@/components/SplashScreen";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agentic Testing Panel",
  description:
    "Panel para testear agentes de IA (orquestador + subagentes + evaluator).",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

// Script anti-flash: aplica el tema (dark/light) antes del primer paint.
// Default: dark. Si el usuario eligió light explícitamente, lo respeta.
const themeScript = `
try {
  var t = localStorage.getItem('atp.theme');
  if (t !== 'light') {
    document.documentElement.classList.add('dark');
  }
} catch (e) {
  document.documentElement.classList.add('dark');
}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: el script de tema agrega la clase `dark` al
    // <html> antes de la hidratación; ese desajuste es intencional.
    <html
      lang="es"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <SplashScreen />
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              fontSize: "13px",
              borderRadius: "10px",
              background: "rgb(23 23 23)",
              color: "rgb(245 245 245)",
              border: "1px solid rgb(38 38 38)",
            },
          }}
        />
      </body>
    </html>
  );
}
