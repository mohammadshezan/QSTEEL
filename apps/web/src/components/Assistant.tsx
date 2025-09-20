"use client";
import { useState } from "react";
import { withBase } from "@/lib/config";

export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [a, setA] = useState<string[]>([]);
  const ask = async () => {
  const r = await fetch(withBase('/assistant'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')||''}` }, body: JSON.stringify({ query: q })});
    const data = await r.json();
    setA(prev => [...prev, `You: ${q}`, `AI: ${data.answer}`]);
    setQ("");
  };
  return (
    <div className="fixed bottom-4 right-4">
      {open && (
        <div className="mb-3 w-80 rounded-xl bg-white/5 border border-white/10 p-3">
          <div className="h-48 overflow-auto text-sm space-y-1">
            {a.map((l,i)=>(<div key={i} className="text-gray-200">{l}</div>))}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Ask e.g. delayed rakes this week" className="flex-1 rounded-md bg-black/40 border border-white/10 p-2 text-sm" />
            <button onClick={ask} className="rounded-md bg-brand-green text-black px-3">Ask</button>
          </div>
        </div>
      )}
      <button onClick={()=>setOpen(v=>!v)} className="rounded-full bg-brand-green text-black px-4 py-2 shadow-lg">Assistant</button>
    </div>
  );
}
