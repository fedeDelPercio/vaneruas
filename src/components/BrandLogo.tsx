// Logo de marca neutro (dot). Es el default del template: el `DashboardHeader`
// importa `<BrandLogo />` y este componente decide qué renderea.
//
// Cuando montes un cliente con marca propia, sobre-escribí este archivo con
// la versión del cliente (PNG + separador), siguiendo la convención de
// CLAUDE.md sección "Logo de cliente (brand-logo)". El default queda como
// fallback si la branch del cliente no provee uno.

export function BrandLogo() {
  return (
    <span
      aria-hidden
      className="h-1.5 w-1.5 rounded-full bg-neutral-900 dark:bg-neutral-50"
    />
  );
}
