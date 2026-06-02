// Splash de bienvenida (template: no-op).
//
// El template no incluye una pantalla de splash por default — los clientes
// que quieran el efecto "wow" al abrir el panel sobre-escriben este archivo
// con su versión (overlay negro full-screen con su logo, ~2.2s de animación).
// Ver CLAUDE.md sección "Splash de bienvenida (opcional, por-cliente)" para
// el patrón completo.
//
// Para que el `RootLayout` pueda montar `<SplashScreen />` sin condicionales,
// el template provee este stub que no renderea nada.

export function SplashScreen() {
  return null;
}
