"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";

const inputClass = "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] outline-none transition dark:border-neutral-800 dark:bg-neutral-900";

function LoginForm() {
  const volver = useSearchParams().get("volver");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? "No se pudo entrar");
        return;
      }

      const localPath = volver?.startsWith("/") && !/^\/[\s/\\]/.test(volver) ? volver : "/";
      const destination = new URL(localPath, window.location.origin);
      window.location.replace(destination.origin === window.location.origin ? destination.href : "/");
    } catch {
      setError("No se pudo conectar con el panel");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-white p-4 text-neutral-900 dark:bg-neutral-950 dark:text-white">
      <section className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex justify-center"><BrandLogo /></div>
        <h1 className="mt-5 text-center text-[22px] font-medium leading-tight">Ingresá al panel</h1>
        <form method="post" onSubmit={login} className="mt-6 space-y-3">
          <label className="block text-[11.5px] font-medium text-neutral-700 dark:text-neutral-300">
            Usuario
            <input name="username" autoComplete="username" autoCapitalize="none" maxLength={64} required className={inputClass} />
          </label>
          <label className="block text-[11.5px] font-medium text-neutral-700 dark:text-neutral-300">
            Contraseña
            <input name="password" type="password" autoComplete="current-password" maxLength={200} required className={inputClass} />
          </label>
          {error && <p role="alert" className="text-[12px] text-red-600 dark:text-red-400">{error}</p>}
          <button type="submit" disabled={submitting} className="btn-gold w-full disabled:cursor-not-allowed disabled:opacity-40">
            {submitting ? "Ingresando…" : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
