"use client";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import io from "socket.io-client";
import { withBase, SOCKET_URL } from "@/lib/config";
import { useEffect, useMemo, useState } from "react";

const rakeIcon = L.divIcon({
  className: "rake-icon",
  html: '<div class="pulse-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

type Position = { id: string; lat: number; lng: number; speed: number; temp?: number; rfid?: string };

export default function MapLive() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [prev, setPrev] = useState<Record<string, Position>>({});
  const [routes, setRoutes] = useState<any[]>([]);
  const [eco, setEco] = useState<{ bestIndex?: number } | null>(null);
  const [meta, setMeta] = useState<any | null>(null);
  const [highlightEco, setHighlightEco] = useState<boolean>(true);

  useEffect(() => {
    // Subscribe to live socket positions
  const s = (window as any).io?.(SOCKET_URL || undefined) || (awaitSocket());
    function onPos(data: Position[]) {
      // interpolate towards new positions over 1s
      const mapPrev: Record<string, Position> = {};
      positions.forEach(p => { mapPrev[p.id] = p; });
      setPrev(mapPrev);
      const start = performance.now();
      const duration = 1000;
      const from = mapPrev;
      const to: Record<string, Position> = {};
      data.forEach(p => to[p.id] = p);
      function step(now: number) {
        const t = Math.min(1, (now - start) / duration);
        const blended: Position[] = data.map(p => {
          const a = from[p.id] || p;
          return { ...p, lat: a.lat + (p.lat - a.lat)*t, lng: a.lng + (p.lng - a.lng)*t };
        });
        setPositions(blended);
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    s.on("positions", onPos);
    // Fetch routes with filters and eco metadata
    const token = localStorage.getItem('token')||'';
    let role = 'guest';
    try { const p = token? JSON.parse(atob(token.split('.')[1])): null; role = p?.role || 'guest'; } catch {}
  const saved = localStorage.getItem(`routeFilters:${role}`);
  const f = saved? JSON.parse(saved): { cargo: 'ore', loco: 'diesel', grade: 0, tonnage: 3000, routeKey: 'BKSC-DGR' };
  const qs = new URLSearchParams({ cargo: f.cargo, loco: f.loco, grade: String(f.grade ?? 0), tonnage: String(f.tonnage ?? 3000), routeKey: String(f.routeKey || 'BKSC-DGR') }).toString();
  fetch(withBase(`/map/routes?${qs}`), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json())
      .then(d=>{ setRoutes(d.routes||[]); setEco(d.eco||null); setMeta(d.meta||null); })
      .catch(()=>{ setRoutes([]); setEco(null); setMeta(null); });
    const onApply = (e:any) => {
      const det = e?.detail || {};
  const q = new URLSearchParams({ cargo: det.cargo || f.cargo, loco: det.loco || f.loco, grade: String(det.grade ?? f.grade ?? 0), tonnage: String(det.tonnage ?? f.tonnage ?? 3000), routeKey: det.routeKey || f.routeKey || 'BKSC-DGR' }).toString();
  fetch(withBase(`/map/routes?${q}`), { headers: { Authorization: `Bearer ${localStorage.getItem('token')||''}` } })
        .then(r=>r.json()).then(d=>{ setRoutes(d.routes||[]); setEco(d.eco||null); setMeta(d.meta||null); }).catch(()=>{});
    };
    window.addEventListener('routeFilters:apply', onApply as any);
    return () => { s.off("positions", onPos); window.removeEventListener('routeFilters:apply', onApply as any); };
  }, []);

  const center = useMemo(() => [23.64, 86.16] as [number, number], []);

  const AnyMap = MapContainer as any;
  const AnyTile = TileLayer as any;
  const AnyMarker = Marker as any;
  const AnyPolyline = Polyline as any;

  return (
    <div className="h-[70vh]">
      <AnyMap center={center} zoom={12} scrollWheelZoom={true} className="h-full">
        <AnyTile
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {routes.map((r, i) => {
          const isEco = i === (eco?.bestIndex ?? -1);
          const color = isEco && highlightEco ? '#22C55E' : statusColor(r.status);
          const weight = isEco && highlightEco ? 7 : 5;
          return <AnyPolyline key={i} positions={r.from && r.to ? [r.from, r.to] : []} pathOptions={{ color, weight, opacity: 0.9 }} />;
        })}
        {positions.map(p => (
          <AnyMarker key={p.id} position={[p.lat, p.lng]} icon={rakeIcon}>
            <Popup>
              <div className="text-sm">
                <div className="font-medium">{p.id}</div>
                <div>Speed: {p.speed} km/h</div>
                {p.temp !== undefined && <div>Temp: {p.temp} °C</div>}
                {p.rfid && <div>RFID: {p.rfid}</div>}
              </div>
            </Popup>
          </AnyMarker>
        ))}
      </AnyMap>
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 bg-black/60 border border-white/10 rounded-md px-3 py-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={highlightEco} onChange={e=>setHighlightEco(e.target.checked)} />
          Highlight eco-route
        </label>
        {meta && (
          <span className="text-xs text-gray-300">EF {meta.efPerKm} tCO₂/km · {meta.cargo}/{meta.loco} · {meta.grade}% · {meta.tonnage}t</span>
        )}
      </div>
    </div>
  );
}

function statusColor(status?: string) {
  switch(status) {
    case 'congested': return '#F87171'; // red
    case 'busy': return '#F59E0B'; // amber
    default: return '#10B981'; // green
  }
}

function awaitSocket() { return SOCKET_URL ? io(SOCKET_URL) : io(); }
