"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/ui/primitives";

export default function Login() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <main className="flex h-dvh items-center justify-center px-6">
      <form
        className="w-full max-w-64"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: value }) });
          if (res.ok) router.replace("/");
          else {
            setError((await res.json().catch(() => null))?.error ?? "That didn't work.");
            setBusy(false);
          }
        }}
      >
        <h1 className="font-medium">Factory</h1>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          aria-label="Password"
          placeholder="Password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          className="mt-4 h-8 w-full rounded-md border border-line-2 bg-surface px-2.5 text-sm outline-none placeholder:text-ink-3 focus:border-ink"
        />
        <div className="mt-3 flex items-center justify-between">
          <p role="alert" className="text-xs text-accent">{error}</p>
          <Button tone="primary" type="submit" disabled={busy || !value}>
            Enter
          </Button>
        </div>
      </form>
    </main>
  );
}
