"use client";
import Link from "next/link";

export default function Nav() {
  const authed = typeof window !== 'undefined' && !!localStorage.getItem('token');
  const role = typeof window !== 'undefined' ? (()=>{ try { const t=localStorage.getItem('token')||''; const p=t?JSON.parse(atob(t.split('.')[1])):null; return p?.role||'guest'; } catch { return 'guest'; } })() : 'guest';
  return (
    <header className="sticky top-0 z-40 backdrop-blur bg-black/30 border-b border-white/10">
      <nav className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <img
            src="/brand/logo.svg"
            alt="QSTEEL"
            className="h-7 w-7"
            onError={(e)=>{
              const img = e.currentTarget as HTMLImageElement;
              const tried = img.getAttribute('data-fallback') || 'svg';
              if (tried === 'svg') {
                img.setAttribute('data-fallback','png');
                img.src = '/brand/logo.png';
              } else if (tried === 'png') {
                img.setAttribute('data-fallback','default');
                img.src = '/logo.svg';
              }
            }}
          />
          <span className="font-semibold">QSTEEL</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/planner">Planner</Link>
          {role==='yard' && <Link href="/yard-actions">Yard</Link>}
          <Link href="/reports">Reports</Link>
          <Link href="/map">Map</Link>
          {!authed ? (
            <Link href="/signin" className="rounded-md bg-brand-green text-black px-3 py-1">Sign in</Link>
          ) : (
            <button onClick={()=>{ localStorage.removeItem('token'); location.href='/'; }} className="rounded-md border border-white/10 px-3 py-1">Sign out</button>
          )}
        </div>
      </nav>
    </header>
  );
}
