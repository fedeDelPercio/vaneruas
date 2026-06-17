import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "react-hot-toast";

// Fuente de marca Vanesa Rúas: Poppins en toda la jerarquía (ver design-system).
// Se mantiene un mono solo para datos tabulares (códigos, N° de operación,
// timestamps), donde la legibilidad monoespaciada ayuda en un panel de gestión.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});
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
      className={`${poppins.variable} ${GeistMono.variable}`}
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
              borderRadius: "12px",
              background: "#1a1a1a",
              color: "#ffffff",
              border: "1px solid #2a2a2a",
            },
          }}
        />
      </body>
    </html>
  );
}
