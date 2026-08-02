"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isAuthConfigured } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isAuthConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">
          Auth not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
        </p>
      </div>
    );
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase!.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");

    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setInfo("Check your email for a password reset link.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-8 w-1.5 rounded-full bg-blue-600" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">NSF HERD Research Intelligence</h1>
            <p className="text-xs text-slate-500">
              {mode === "login" ? "Sign in to continue" : "Reset your password"}
            </p>
          </div>
        </div>

        {mode === "login" ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
                placeholder="you@university.edu"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => { setMode("reset"); setError(""); setInfo(""); }}
              className="w-full text-center text-xs text-slate-500 hover:text-blue-600"
            >
              Forgot your password?
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
                placeholder="you@university.edu"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            {info && <p className="text-xs text-green-600">{info}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <button
              type="button"
              onClick={() => { setMode("login"); setError(""); setInfo(""); }}
              className="w-full text-center text-xs text-slate-500 hover:text-blue-600"
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
