"use client";
import Guard from "@/components/Guard";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function CustomerDashboard() {
  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Customer Dashboard</h1>
          <div className="flex items-center gap-2">
            <a href="/customer/orders/new" className="rounded bg-brand-green text-black px-3 py-2">Place Order</a>
            <a href="/customer/orders" className="rounded border border-white/20 px-3 py-2">My Orders</a>
          </div>
        </header>
        <ProfileCard />
        <OrdersPreview />
      </div>
    </Guard>
  );
}

function ProfileCard() {
  const [profile, setProfile] = useState<any>(null);
  useEffect(() => {
    const token = localStorage.getItem('token')||'';
    fetch(withBase('/customer/profile'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(d=>setProfile(d.profile)).catch(()=>{});
  }, []);
  if (!profile) return <div className="border border-white/10 rounded p-4">Loading profile…</div>;
  return (
    <div className="border border-white/10 rounded p-4">
      <div className="font-medium mb-2">Welcome, {profile.name}</div>
      <div className="text-sm text-gray-400">Company: {profile.company} · GSTIN: {profile.gstin}</div>
    </div>
  );
}

function OrdersPreview() {
  const [orders, setOrders] = useState<any[]>([]);
  useEffect(() => {
    const token = localStorage.getItem('token')||'';
    fetch(withBase('/customer/orders'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(d=>setOrders(d.orders||[])).catch(()=>{});
  }, []);
  return (
    <div>
      <div className="font-medium mb-2">Recent Orders</div>
      <div className="grid gap-3">
        {(orders||[]).slice(0,5).map((o:any)=> (
          <a key={o.orderId} href={`/customer/orders/${o.orderId}`} className="block border border-white/10 rounded p-3 hover:bg-white/5">
            <div className="flex items-center justify-between">
              <div>#{o.orderId.slice(0,8)} · {o.cargo} · {o.quantityTons}T</div>
              <div className="text-sm text-gray-400">{o.status}</div>
            </div>
            <div className="text-xs text-gray-400">{o.sourcePlant} → {o.destination} · ETA {new Date(o.estimate?.eta).toLocaleString()}</div>
          </a>
        ))}
        {orders.length === 0 && <div className="text-gray-400 text-sm">No orders yet. Place your first order.</div>}
      </div>
    </div>
  );
}
