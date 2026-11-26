"use client";

export function redirectToLogin() {
  if (window.location.pathname === "/login") return;
  const volver = window.location.pathname + window.location.search;
  window.location.replace(`/login?${new URLSearchParams({ volver })}`);
}
