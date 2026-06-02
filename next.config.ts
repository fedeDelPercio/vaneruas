import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El SDK de Anthropic se carga desde node_modules en runtime: marcarlo como
  // externo evita que Next intente bundlearlo (no es necesario, pero limpia
  // el bundle y deja el árbol de dependencias más claro).
  serverExternalPackages: ["@anthropic-ai/sdk", "@whiskeysockets/baileys", "pino"],
  // Los prompts del agente son archivos .md que se leen en runtime. Hay que
  // incluirlos explicitamente en el output tracing para que viajen al deploy
  // serverless (si no, no estarian disponibles en produccion).
  outputFileTracingIncludes: {
    "/api/**": ["./src/lib/agent/prompts/**/*.md"],
  },
};

export default nextConfig;
