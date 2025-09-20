import { withBase } from "@/lib/config";
"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("123456");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { push } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      setLoading(true);
  const r = await fetch(withBase("/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Login failed");
      localStorage.setItem("token", data.token);
      push({ text: 'Signed in', tone: 'success' });
      window.location.href = "/dashboard";
    } catch (e: any) {
      setError(e.message);
      push({ text: e.message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 bg-white/5 border border-white/10 p-6 rounded-xl">
        <h2 className="text-xl font-semibold">Sign in</h2>
        <div>
          <label className="text-sm text-gray-300">Email</label>
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@sail.test" className="mt-1 w-full rounded-md bg-black/40 border border-white/10 p-2" />
        </div>
        <div>
          <label className="text-sm text-gray-300">OTP</label>
          <input value={otp} onChange={e=>setOtp(e.target.value)} className="mt-1 w-full rounded-md bg-black/40 border border-white/10 p-2" />
          <p className="text-xs text-gray-400 mt-1">Use 123456 for demo</p>
        </div>
        {error && <p className="text-sm text-brand-red">{error}</p>}
  <button disabled={loading} className="w-full rounded-md bg-brand-green text-black py-2 font-medium">{loading? 'Signing in…':'Continue'}</button>
      </form>
    </main>
  );
}
