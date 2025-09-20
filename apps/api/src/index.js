import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { createServer } from 'http';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { Server as SocketIOServer } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const app = express();
const httpServer = createServer(app);

// CORS configuration (HTTP + WebSocket) driven by env
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const allowAll = CORS_ORIGINS.length === 0;
const corsOptions = {
  origin: allowAll ? '*' : CORS_ORIGINS,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  // Only enable credentials when specific origins are configured; '*' with credentials is invalid in browsers
  credentials: !allowAll,
};
const io = new SocketIOServer(httpServer, {
  cors: corsOptions,
});

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
let prisma = null;
async function initPrisma() {
  try {
    if (process.env.DATABASE_URL) {
      const p = new PrismaClient();
      await p.$connect();
      prisma = p;
      console.log('Prisma connected');
    }
  } catch (e) {
    console.warn('Prisma not connected, falling back to in-memory:', e?.message || e);
    prisma = null;
  }
}
initPrisma();

// Redis (optional) for caching
let redis = null;
async function initRedis() {
  try {
    const url = process.env.REDIS_URL || process.env.REDIS_HOST || 'redis://127.0.0.1:6379';
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      autoResubscribe: false,
      retryStrategy: null,
      reconnectOnError: () => false,
    });
    client.on?.('error', () => {}); // swallow initial connection errors in demo mode
    await client.connect?.();
    await client.ping();
    redis = client;
    console.log('Redis connected');
  } catch (e) {
    console.warn('Redis not connected, proceeding without cache:', e?.message || e);
    try { if (typeof client?.quit === 'function') await client.quit(); } catch {}
    redis = null;
  }
}
initRedis();

// Friendly root route
app.get('/', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    name: 'QSTEEL API',
    status: 'ok',
    time: new Date().toISOString(),
    docs: 'https://github.com/mohammadshezan/QSTEEL',
    endpoints: {
      login: { method: 'POST', url: `${base}/auth/login`, body: { email: 'admin@sail.test', otp: '123456' } },
      kpis: { method: 'GET', url: `${base}/kpis`, auth: 'Bearer <token>' },
      mapRoutes: { method: 'GET', url: `${base}/map/routes?cargo=ore&loco=diesel&grade=0&tonnage=3000&routeKey=BKSC-DGR`, auth: 'Bearer <token>' },
      alerts: { method: 'GET', url: `${base}/alerts`, auth: 'Bearer <token>' },
      healthz: { method: 'GET', url: `${base}/healthz` },
    },
  });
});

// Unauthenticated health probe
app.get('/healthz', async (req, res) => {
  let redisConnected = false;
  try { if (redis) { const pong = await redis.ping(); redisConnected = pong === 'PONG'; } } catch {}
  res.json({ ok: true, uptimeSec: Math.floor(process.uptime()), prismaConnected: !!prisma, redisConnected });
});

async function cacheGet(key) {
  try { if (!redis) return null; const v = await redis.get(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
async function cacheSet(key, value, ttlSeconds = 60) {
  try { if (!redis) return; await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds); } catch { /* noop */ }
}

// Centralized demo/mock dataset for fallback mode
const MOCK_DATA = {
  plants: [
    { code: 'BKSC', name: 'Bokaro', location: 'Bokaro Steel City' },
    { code: 'DGR', name: 'Durgapur', location: 'Durgapur' },
    { code: 'ROU', name: 'Rourkela', location: 'Rourkela' },
    { code: 'BPHB', name: 'Bhilai', location: 'Bhilai Steel Plant' },
  ],
  yards: [
    { code: 'DGR-Y1', name: 'Durgapur Yard 1', plant: 'DGR' },
    { code: 'ROU-Y1', name: 'Rourkela Yard 1', plant: 'ROU' },
    { code: 'BPHB-Y1', name: 'Bhilai Yard 1', plant: 'BPHB' },
  ],
  routes: [
    { id: 'R1', from: 'BKSC', to: 'DGR', distanceKm: 300, routeKey: 'BKSC-DGR', name: 'BKSC → DGR' },
    { id: 'R2', from: 'BKSC', to: 'ROU', distanceKm: 450, routeKey: 'BKSC-ROU', name: 'BKSC → ROU' },
    { id: 'R3', from: 'BKSC', to: 'BPHB', distanceKm: 600, routeKey: 'BKSC-BPHB', name: 'BKSC → BPHB' },
  ],
  rakes: [
    { id: 'RK001', name: 'Rake 1', route: 'R1', status: 'Under Construction', cargoType: 'TMT Bars', locomotive: 'Electric', grade: 'Fe500', tonnage: 500 },
    { id: 'RK002', name: 'Rake 2', route: 'R2', status: 'Loading', cargoType: 'H-Beams', locomotive: 'Diesel', grade: 'Fe500', tonnage: 400 },
    { id: 'RK003', name: 'Rake 3', route: 'R3', status: 'Dispatched', cargoType: 'Coils', locomotive: 'Electric', grade: 'Fe600', tonnage: 300 },
  ],
  wagons: [
    { id: 'W001', rake: 'RK001', type: 'Open', cargo: 'TMT Bars', capacityTons: 100, loadedTons: 50 },
    { id: 'W002', rake: 'RK001', type: 'Open', cargo: 'TMT Bars', capacityTons: 100, loadedTons: 100 },
    { id: 'W003', rake: 'RK002', type: 'Covered', cargo: 'H-Beams', capacityTons: 80, loadedTons: 60 },
    { id: 'W004', rake: 'RK002', type: 'Covered', cargo: 'H-Beams', capacityTons: 80, loadedTons: 80 },
    { id: 'W005', rake: 'RK003', type: 'Flat', cargo: 'Coils', capacityTons: 120, loadedTons: 120 },
  ],
  stockDemand: [
    { yard: 'DGR-Y1', grade: 'TMT Bars', stock: 500, demand: 700 },
    { yard: 'DGR-Y1', grade: 'H-Beams', stock: 300, demand: 400 },
    { yard: 'DGR-Y1', grade: 'Coils', stock: 200, demand: 250 },
    { yard: 'ROU-Y1', grade: 'TMT Bars', stock: 600, demand: 550 },
    { yard: 'ROU-Y1', grade: 'H-Beams', stock: 150, demand: 200 },
    { yard: 'ROU-Y1', grade: 'Coils', stock: 100, demand: 120 },
    { yard: 'BPHB-Y1', grade: 'TMT Bars', stock: 450, demand: 500 },
    { yard: 'BPHB-Y1', grade: 'H-Beams', stock: 250, demand: 300 },
    { yard: 'BPHB-Y1', grade: 'Coils', stock: 150, demand: 180 },
  ],
  alerts: [
    { id: 'A001', type: 'Stock Low', message: 'TMT Bars low at Durgapur Yard 1', severity: 'high', ts: '2025-09-20 10:00' },
    { id: 'A002', type: 'Delay Risk', message: 'Rake RK002 may be delayed on R2', severity: 'medium', ts: '2025-09-20 10:05' },
    { id: 'A003', type: 'Eco Route Alert', message: 'Consider electric loco for RK003', severity: 'low', ts: '2025-09-20 10:10' },
  ],
  dispatches: [
    { id: 'D001', rake: 'RK001', yard: 'DGR-Y1', status: 'Confirmed', ts: '2025-09-20 10:15' },
    { id: 'D002', rake: 'RK002', yard: 'ROU-Y1', status: 'Dispatched', ts: '2025-09-20 10:20' },
    { id: 'D003', rake: 'RK003', yard: 'BPHB-Y1', status: 'Completed', ts: '2025-09-20 10:25' },
  ],
  positions: [
    { id: 'RK001', lat: 23.6360, lng: 86.1389, status: 'Under Construction', speed: 0 },
    { id: 'RK002', lat: 23.5350, lng: 86.1980, status: 'Loading', speed: 0 },
    { id: 'RK003', lat: 21.2087, lng: 81.3460, status: 'Dispatched', speed: 42 },
  ],
  forecast: [
    { rake: 'RK001', forecast7d: 550, suggestedRoute: 'BKSC → DGR' },
    { rake: 'RK002', forecast7d: 420, suggestedRoute: 'BKSC → ROU' },
    { rake: 'RK003', forecast7d: 300, suggestedRoute: 'BKSC → BPHB' },
  ],
};

// Simple in-memory users for demo
const users = [
  { id: 1, email: 'admin@sail.test', role: 'admin' },
  { id: 2, email: 'manager@sail.test', role: 'manager' },
  { id: 3, email: 'yard@sail.test', role: 'yard' }
];

// Simple hash-chained ledger
const ledger = [];
function appendLedger(entry) {
  const prevHash = ledger.length ? ledger[ledger.length - 1].hash : 'GENESIS';
  const payload = { ...entry, prevHash, ts: Date.now() };
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const block = { ...payload, hash };
  ledger.push(block);
  return block;
}

app.post('/auth/login', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });
  if (otp !== '123456') return res.status(401).json({ error: 'Invalid OTP' });
  const user = users.find(u => u.email === email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user });
});

function auth(role) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (role && payload.role !== role && payload.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

app.get('/kpis', auth(), async (req, res) => {
  const cacheKey = 'kpis:v1';
  const cached = await cacheGet(cacheKey);
  if (cached) return res.json(cached);
  if (prisma) {
    try {
      const pending = await prisma.rake.count({ where: { status: 'PENDING' } });
      const dispatched = await prisma.rake.count({ where: { status: 'DISPATCHED' } });
      const utilization = dispatched + pending > 0 ? dispatched / (dispatched + pending) : 0.78;
      // naive sustainability metrics
      const carbonIntensityPerRake = Number(Math.max(0.4, 1.8 - utilization * 1.2).toFixed(2)); // tCO2/rake (demo)
      const co2Total = Number((carbonIntensityPerRake * (dispatched || 1)).toFixed(2));
      const ecoSavingsPercent = 12; // demo constant for day
      const payload = {
        pendingRakes: pending,
        dispatchedRakes: dispatched,
        utilization,
        delayProbability: 0.18,
        fuelConsumption: [10,12,8,9,11,7,10],
        carbonIntensityPerRake,
        co2Total,
        ecoSavingsPercent,
        ecoRouteHint: 'Avoid Segment S1 congestion; choose S3 to save ~12% emissions.'
      };
      await cacheSet(cacheKey, payload, 60);
      return res.json(payload);
    } catch (e) { /* fallthrough */ }
  }
  const fallback = {
    pendingRakes: Array.isArray(MOCK_DATA.rakes)? MOCK_DATA.rakes.filter(r=> (r.status||'').toLowerCase() !== 'dispatched').length : 6,
    dispatchedRakes: Array.isArray(MOCK_DATA.rakes)? MOCK_DATA.rakes.filter(r=> (r.status||'').toLowerCase() === 'dispatched').length : 12,
    utilization: (()=>{ const p = Array.isArray(MOCK_DATA.rakes)? MOCK_DATA.rakes.filter(r=> (r.status||'').toLowerCase() !== 'dispatched').length : 6; const d = Array.isArray(MOCK_DATA.rakes)? MOCK_DATA.rakes.filter(r=> (r.status||'').toLowerCase() === 'dispatched').length : 12; return (d+p)>0 ? d/(d+p) : 0.78; })(),
    delayProbability: 0.18,
    fuelConsumption: [10,12,8,9,11,7,10],
    carbonIntensityPerRake: 0.98,
    co2Total: 11.76,
    ecoSavingsPercent: 12,
    ecoRouteHint: 'Avoid Segment S1 congestion; choose S3 to save ~12% emissions.'
  };
  await cacheSet(cacheKey, fallback, 60);
  res.json(fallback);
});

app.get('/map/routes', auth(), async (req, res) => {
  const cargo = String(req.query.cargo || 'ore').toLowerCase();
  const loco = String(req.query.loco || 'diesel').toLowerCase();
  const grade = Number(req.query.grade || 0); // % grade (slope)
  const tonnage = Number(req.query.tonnage || 3000); // total train tonnage
  const routeKey = String(req.query.routeKey || '').toUpperCase();
  const cacheKey = `routes:v3:c:${cargo}:l:${loco}:g:${grade}:t:${tonnage}:rk:${routeKey||'default'}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return res.json(cached);
  const statuses = ['clear','busy','congested'];
  const pick = () => statuses[Math.floor(Math.random()*statuses.length)];
  let segments = [];
  if (routeKey) {
    let seq = null;
    if (prisma) {
      try {
        const route = await prisma.route.findUnique({
          where: { key: routeKey },
          include: { routeStations: { include: { station: true }, orderBy: { seq: 'asc' } } }
        });
        if (route && route.routeStations.length >= 2) {
          seq = route.routeStations.map(rs => ({ code: rs.station.code, coord: [rs.station.lat, rs.station.lng] }));
        }
      } catch (e) { /* ignore and fallback */ }
    }
    if (seq && seq.length >= 2) {
      for (let i=0; i<seq.length-1; i++) {
        const a = seq[i].coord; const b = seq[i+1].coord;
        segments.push({ from: a, to: b, status: pick(), label: `${seq[i].code}→${seq[i+1].code}` });
      }
    } else {
      // fallback presets
      const STN = {
        BKSC: [23.658, 86.151], DGR: [23.538, 87.291], Dhanbad: [23.795, 86.430], Asansol: [23.685, 86.974], Andal: [23.593, 87.242],
        ROU: [22.227, 84.857], Purulia: [23.332, 86.365],
        BPHB: [21.208, 81.379], Norla: [19.188, 82.787],
      };
      const presets = {
        'BKSC-DGR': ['BKSC','Dhanbad','Asansol','Andal','DGR'],
        'BKSC-ROU': ['BKSC','Purulia','ROU'],
        'BKSC-BPHB': ['BKSC','Norla','BPHB'],
      };
      const p = presets[routeKey];
      if (p) {
        for (let i=0;i<p.length-1;i++) {
          const a = STN[p[i]]; const b = STN[p[i+1]];
          if (a && b) segments.push({ from: a, to: b, status: pick(), label: `${p[i]}→${p[i+1]}` });
        }
      }
    }
  }
  if (!segments.length) {
    // ultimate fallback near Bokaro
    segments = [
      { from: [23.66,86.15], to: [23.63,86.18], status: pick(), label: 'YardA→YardB' },
      { from: [23.66,86.15], to: [23.60,86.20], status: pick(), label: 'YardA→Alt' },
    ];
  }
  const payload = { origin: 'Bokaro', routes: segments };
  // emission factor model (demo): base EF per km by cargo & loco, with grade and status multipliers
  const baseByCargo = { ore: 0.022, coal: 0.024, steel: 0.02, cement: 0.021 };
  const locoFactor = { diesel: 1.0, electric: 0.6, hybrid: 0.8 };
  const baseKm = baseByCargo[cargo] ?? 0.022;
  // locomotive efficiency curve vs tonnage (demo):
  // diesel suffers at high tonnage, electric scales better; clamp tonnage 1000..6000
  const t = Math.max(1000, Math.min(tonnage, 6000));
  const curve = {
    diesel: 1 + (t - 3000) / 3000 * 0.15,   // +-15% across range
    electric: 0.8 + (t - 3000) / 3000 * 0.08, // 0.8..0.88
    hybrid: 0.9 + (t - 3000) / 3000 * 0.10,
  };
  const locoMul = (curve[loco] ?? 1.0) * (locoFactor[loco] ?? 1.0);
  const gradeMul = 1 + Math.max(0, Math.min(grade, 6)) * 0.03; // up to +18% at 6% grade
  const efPerKm = Number((baseKm * locoMul * gradeMul).toFixed(5)); // tCO2 per km
  const statusFactor = (s) => s==='clear'?1 : s==='busy'?1.1 : 1.25;
  const haversine = (a,b) => {
    const R=6371; const toRad = (d)=>d*Math.PI/180;
    const dLat = toRad(b[0]-a[0]); const dLng = toRad(b[1]-a[1]);
    const la1=toRad(a[0]); const la2=toRad(b[0]);
    const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  };
  payload.routes = payload.routes.map(r => {
    const km = haversine(r.from, r.to);
    const co2 = Number((km * efPerKm * statusFactor(r.status)).toFixed(3));
    return { ...r, km: Number(km.toFixed(2)), co2_tons: co2 };
  });
  const bestIdx = payload.routes.reduce((m,_,i,arr)=> arr[i].co2_tons < arr[m].co2_tons ? i : m, 0);
  const worst = payload.routes.reduce((mx,r)=> Math.max(mx, r.co2_tons), 0);
  const best = payload.routes[bestIdx].co2_tons;
  payload.eco = { bestIndex: bestIdx, savingsPercent: Math.round((1 - (best/(worst||best))) * 100) };
  payload.meta = { cargo, loco, grade, tonnage, efPerKm, routeKey, factors: { locoMul, gradeMul } };
  await cacheSet(cacheKey, payload, 30);
  res.json(payload);
});

app.post('/ai/forecast', auth(), async (req, res) => {
  const base = (process.env.ML_URL || process.env.FORECAST_URL || '').replace(/\/$/, '');
  if (base) {
    try {
      const r = await fetch(`${base}/forecast`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) });
      if (!r.ok) throw new Error(`ML service responded ${r.status}`);
      const data = await r.json();
      return res.json(data);
    } catch (e) {
      console.warn('ML_URL fetch failed, using fallback forecast:', e?.message || e);
    }
  }
  // fallback naive forecast
  const series = (req.body?.series && Array.isArray(req.body.series)) ? req.body.series : [10,12,11,13,12,14,15];
  const horizon = req.body?.horizon ?? 7;
  const tail = series.slice(-3);
  const mu = tail.reduce((a,b)=>a+b,0)/tail.length;
  const forecast = Array.from({length: horizon}, (_,i)=> Number((mu + (Math.sin(i/2)*0.3)).toFixed(2)));
  // If a rake is specified, enrich with mock suggested route
  const rake = req.body?.rake;
  const suggestion = MOCK_DATA.forecast.find(f => f.rake === rake);
  res.json({ forecast, suggestedRoute: suggestion?.suggestedRoute });
});

// Ledger endpoints
async function processDispatch({ rakeId, from, to, cargo, tonnage, actor }) {
  const block = appendLedger({ type: 'DISPATCH', rakeId, from, to, cargo, tonnage, actor });
  try {
    if (prisma) {
      const prevHash = ledger.length > 1 ? ledger[ledger.length - 2].hash : 'GENESIS';
      await prisma.dispatch.create({ data: { rake: { connect: { code: rakeId } }, from: from||'', to: to||'', cargo: cargo||'', tonnage: tonnage||0, hash: block.hash, prevHash } });
      await prisma.rake.update({ where: { code: rakeId }, data: { status: 'DISPATCHED' } });
    }
  } catch (e) { console.warn('DB write failed, ledger only:', e?.message || e); }
  return block;
}

app.post('/ledger/dispatch', auth(), async (req, res) => {
  const { rakeId, from, to, cargo, tonnage } = req.body || {};
  if (!rakeId) return res.status(400).json({ error: 'rakeId required' });
  const block = await processDispatch({ rakeId, from, to, cargo, tonnage, actor: req.user?.email });
  res.json(block);
});

app.get('/ledger', auth(), (req, res) => {
  res.json({ length: ledger.length, chain: ledger });
});

// Yard endpoints
app.get('/yard/rakes', auth(), async (req, res) => {
  // list pending rakes for yard operations
  if (prisma) {
    try {
      const rakes = await prisma.rake.findMany({ where: { status: 'PENDING' }, include: { yard: true } });
      return res.json(rakes.map(r => ({ code: r.code, yard: r.yard?.name || null, status: r.status })));
    } catch (e) { /* fallthrough */ }
  }
  // fallback demo data
  res.json([
    { code: 'rake-101', yard: 'Yard A', status: 'PENDING' },
    { code: 'rake-202', yard: 'Yard B', status: 'PENDING' },
    { code: 'rake-303', yard: 'Yard A', status: 'PENDING' },
  ]);
});

app.post('/yard/rake/:code/confirm-loading', auth('yard'), async (req, res) => {
  const code = req.params.code;
  const block = appendLedger({ type: 'LOADING_CONFIRMED', rakeId: code, actor: req.user?.email });
  res.json(block);
});

app.post('/yard/rake/:code/dispatch', auth('yard'), async (req, res) => {
  const code = req.params.code;
  const { from, to, cargo, tonnage } = req.body || {};
  const block = await processDispatch({ rakeId: code, from, to, cargo, tonnage, actor: req.user?.email });
  res.json(block);
});

// Exports
app.get('/export/kpis.csv', auth(), (req, res) => {
  const plant = req.query.plant || 'Bokaro';
  const data = {
    pendingRakes: 6,
    dispatchedRakes: 12,
    utilization: 0.78,
    delayProbability: 0.18,
  };
  const csv = 'plant,metric,value\n' + Object.entries(data).map(([k,v])=>`${plant},${k},${v}`).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="kpis.csv"');
  res.send(csv);
});

app.get('/export/kpis.pdf', auth(), async (req, res) => {
  const plant = req.query.plant || 'Bokaro';
  const cargo = String(req.query.cargo || 'ore').toLowerCase();
  const loco = String(req.query.loco || 'diesel').toLowerCase();
  const grade = Number(req.query.grade || 0);
  const tonnage = Number(req.query.tonnage || 3000);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="kpis-${plant}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  // Header
  doc.fillColor('#111827').fontSize(20).text('QSTEEL — Plant KPIs Report', { align: 'left' });
  doc.moveUp().fillColor('#6B7280').fontSize(10).text(new Date().toLocaleString(), { align: 'right' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').stroke();
  doc.moveDown();

  // Title (try to enrich plant name from DB if available later)
  doc.fillColor('#111827').fontSize(16).text(`Plant: ${plant}`, { continued: false });
  doc.moveDown(0.5);

  // Gather KPIs (reuse logic or fallback)
  let pending = 6, dispatched = 12, utilization = 0.78, delayProbability = 0.18, carbonIntensityPerRake = 0.98, co2Total = 11.76, ecoSavingsPercent = 12;
  if (prisma) {
    try {
      pending = await prisma.rake.count({ where: { status: 'PENDING' } });
      dispatched = await prisma.rake.count({ where: { status: 'DISPATCHED' } });
      utilization = dispatched + pending > 0 ? dispatched / (dispatched + pending) : 0.78;
      carbonIntensityPerRake = Number(Math.max(0.4, 1.8 - utilization * 1.2).toFixed(2));
      co2Total = Number((carbonIntensityPerRake * (dispatched || 1)).toFixed(2));
    } catch {}
  }

  // KPI table
  const rows = [
    ['Pending Rakes', String(pending)],
    ['Dispatched Rakes', String(dispatched)],
    ['Utilization', `${Math.round(utilization * 100)}%`],
    ['Delay Probability', `${Math.round(delayProbability * 100)}%`],
    ['Carbon Intensity per Rake', `${carbonIntensityPerRake} tCO2`],
    ['Total CO₂ Today', `${co2Total} t`],
    ['Eco-route Savings', `${ecoSavingsPercent}%`],
  ];

  const startX = 60, col1 = 240, col2 = 520; let y = doc.y + 10;
  doc.strokeColor('#D1D5DB');
  rows.forEach((r, i) => {
    const [k, v] = r;
    const rowY = y + i * 24;
    doc.fontSize(11).fillColor('#111827').text(k, startX, rowY, { width: col1 - startX });
    doc.fontSize(11).fillColor('#111827').text(v, col1 + 20, rowY, { width: col2 - (col1 + 20) });
    doc.moveTo(startX, rowY + 18).lineTo(col2, rowY + 18).stroke();
  });

  // Route emissions section
  doc.moveDown(1.2);
  doc.fillColor('#111827').fontSize(14).text(`Route Emissions${plant ? ` — ${plant}` : ''}`, { continued: false });
  doc.moveDown(0.3);
  // Build plant-specific routes preferring DB
  const routeKey = String(req.query.routeKey || 'BKSC-DGR').toUpperCase();
  const statuses = ['clear','busy','congested'];
  const pick = () => statuses[Math.floor(Math.random()*statuses.length)];
  let routes = [];
  if (prisma && routeKey) {
    try {
      const route = await prisma.route.findUnique({
        where: { key: routeKey },
        include: { routeStations: { include: { station: true }, orderBy: { seq: 'asc' } } }
      });
      if (route && route.routeStations.length >= 2) {
        for (let i=0;i<route.routeStations.length-1;i++) {
          const a = route.routeStations[i].station; const b = route.routeStations[i+1].station;
          routes.push({ from: [a.lat, a.lng], to: [b.lat, b.lng], status: pick(), label: `${a.code}→${b.code}` });
        }
      }
    } catch {}
  }
  if (!routes.length) {
    const STN = {
      BKSC: [23.658, 86.151], DGR: [23.538, 87.291], Dhanbad: [23.795, 86.430], Asansol: [23.685, 86.974], Andal: [23.593, 87.242],
      ROU: [22.227, 84.857], Purulia: [23.332, 86.365],
      BPHB: [21.208, 81.379], Norla: [19.188, 82.787],
    };
    const presets = {
      'BKSC-DGR': ['BKSC','Dhanbad','Asansol','Andal','DGR'],
      'BKSC-ROU': ['BKSC','Purulia','ROU'],
      'BKSC-BPHB': ['BKSC','Norla','BPHB'],
    };
    const seq = presets[routeKey] || presets['BKSC-DGR'];
    for (let i=0;i<seq.length-1;i++) {
      const a = STN[seq[i]]; const b = STN[seq[i+1]];
      if (a && b) routes.push({ from: a, to: b, status: pick(), label: `${seq[i]}→${seq[i+1]}` });
    }
  }
  const baseByCargo = { ore: 0.022, coal: 0.024, steel: 0.02, cement: 0.021 };
  const locoFactor = { diesel: 1.0, electric: 0.6, hybrid: 0.8 };
  const baseKm = baseByCargo[cargo] ?? 0.022;
  const t = Math.max(1000, Math.min(tonnage, 6000));
  const curve = { diesel: 1 + (t - 3000) / 3000 * 0.15, electric: 0.8 + (t - 3000) / 3000 * 0.08, hybrid: 0.9 + (t - 3000) / 3000 * 0.10 };
  const locoMul = (curve[loco] ?? 1.0) * (locoFactor[loco] ?? 1.0);
  const gradeMul = 1 + Math.max(0, Math.min(grade, 6)) * 0.03;
  const efPerKm = Number((baseKm * locoMul * gradeMul).toFixed(5));
  const statusFactor = (s) => s==='clear'?1 : s==='busy'?1.1 : 1.25;
  const haversine = (a,b) => { const R=6371; const toRad=(d)=>d*Math.PI/180; const dLat=toRad(b[0]-a[0]); const dLng=toRad(b[1]-a[1]); const la1=toRad(a[0]); const la2=toRad(b[0]); const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
  const withEmissions = routes.map(r => { const km=haversine(r.from, r.to); const co2=Number((km*efPerKm*statusFactor(r.status)).toFixed(3)); return { ...r, km: Number(km.toFixed(2)), co2 }; });
  const bestIdx = withEmissions.reduce((m,_,i,arr)=> arr[i].co2 < arr[m].co2 ? i : m, 0);
  const startRx = 60; const c1=90, c2=200, c3=290, c4=380; let ry = doc.y + 8;
  // header row
  doc.fontSize(11).fillColor('#374151');
  doc.text('Segment', startRx, ry, { width: 120 });
  doc.text('KM', c1, ry, { width: 80 });
  doc.text('Status', c2, ry, { width: 80 });
  doc.text('tCO₂', c3, ry, { width: 80 });
  doc.moveTo(startRx, ry + 14).lineTo(520, ry + 14).strokeColor('#D1D5DB').stroke();
  ry += 18;
  withEmissions.forEach((r, i) => {
    const isBest = i === bestIdx;
    doc.fontSize(11).fillColor(isBest ? '#065F46' : '#111827');
  doc.text(r.label || `R${i+1}`, startRx, ry, { width: 120 });
    doc.text(String(r.km), c1, ry, { width: 80 });
    doc.text(String(r.status), c2, ry, { width: 80 });
    doc.text(String(r.co2), c3, ry, { width: 80 });
    if (isBest) doc.fillColor('#10B981').text('Eco', c4, ry, { width: 60 });
    doc.moveTo(startRx, ry + 14).lineTo(520, ry + 14).strokeColor('#E5E7EB').stroke();
    ry += 18;
  });
  doc.fillColor('#6B7280').fontSize(10).text(`Factors: cargo=${cargo}, loco=${loco}, grade=${grade}%, tonnage=${tonnage}t · EF=${efPerKm} tCO₂/km`, startRx, ry + 6);

  // Footer
  doc.moveDown(2);
  doc.fillColor('#6B7280').fontSize(9).text('Generated by QSTEEL · Confidential', 50, 770, { align: 'center' });
  doc.end();
});

// Alerts (simple MVP)
app.get('/alerts', auth(), async (req, res) => {
  // If DB is connected, you might generate alerts from live data; in fallback, return provided mocks
  if (!prisma) {
    return res.json({ alerts: MOCK_DATA.alerts.map(a => ({ id: a.id, type: a.type, message: a.message, level: a.severity, timestamp: a.ts })) });
  }
  // simple heuristic when DB is present
  let pending = 6, dispatched = 12, delayProbability = 0.18, utilization = 0.78;
  try {
    pending = await prisma.rake.count({ where: { status: 'PENDING' } });
    dispatched = await prisma.rake.count({ where: { status: 'DISPATCHED' } });
    utilization = dispatched + pending > 0 ? dispatched / (dispatched + pending) : 0.78;
  } catch {}
  const alerts = [];
  if (delayProbability > 0.15) alerts.push({ id: 'delay', level: 'warning', text: 'Elevated delay risk today. Consider decongesting S1 and prioritizing eco-route.' });
  if (pending > 10) alerts.push({ id: 'backlog', level: 'warning', text: `High pending rakes backlog (${pending}). Allocate crews to clear backlog.` });
  if (utilization < 0.6) alerts.push({ id: 'util', level: 'info', text: 'Utilization below target; review idle capacity for rebalancing.' });
  res.json({ alerts });
});

// Stock / Demand per yard (demo)
app.get('/stock', auth(), async (req, res) => {
  if (!prisma) {
    const grouped = MOCK_DATA.stockDemand.reduce((acc, r) => {
      acc[r.yard] = acc[r.yard] || { yard: r.yard, items: [], stockTons: 0, demandTons: 0 };
      acc[r.yard].items.push({ grade: r.grade, stock: r.stock, demand: r.demand });
      acc[r.yard].stockTons += r.stock;
      acc[r.yard].demandTons += r.demand;
      return acc;
    }, {});
    return res.json({ yards: Object.values(grouped) });
  }
  try {
    const yards = await prisma.yard.findMany({ select: { id: true, name: true, plant: { select: { name: true } } } });
    const payload = yards.map(y => ({ yard: y.name, plant: y.plant?.name || null, stockTons: Math.floor(200 + Math.random()*400), demandTons: Math.floor(150 + Math.random()*350) }));
    return res.json({ yards: payload });
  } catch {
    return res.json({ yards: [] });
  }
});

// List routes (for dynamic selector)
app.get('/routes', auth(), async (req, res) => {
  const plant = String(req.query.plant || '').trim();
  if (prisma) {
    try {
      const where = plant ? { plant: { name: plant } } : {};
      const list = await prisma.route.findMany({ where, select: { key: true, name: true, plant: { select: { name: true } } }, orderBy: { key: 'asc' } });
      return res.json(list.map(r => ({ key: r.key, name: r.name, plant: r.plant?.name || null })));
    } catch (e) { /* fall through */ }
  }
  // fallback
  res.json(MOCK_DATA.routes.map(r => ({ key: r.routeKey, name: r.name, plant: 'Bokaro' })));
});

// Health endpoint (admin)
app.get('/health', auth('admin'), async (req, res) => {
  const prismaConnected = !!prisma;
  let redisConnected = false;
  try { if (redis) { const pong = await redis.ping(); redisConnected = pong === 'PONG'; } } catch {}
  res.json({ prismaConnected, redisConnected, uptimeSec: Math.floor(process.uptime()) });
});

// Assistant stub
app.post('/assistant', auth(), (req, res) => {
  const q = (req.body?.query || '').toLowerCase();
  let answer = 'I can help with rakes, routes, and forecasts.';
  if (q.includes('delayed')) answer = 'There are 2 delayed rakes this week: rake-101 (ETA +45m), rake-202 (ETA +20m).';
  if (q.includes('best route') || q.includes('route')) answer = 'Best route to Stockyard X is via Segment S3 avoiding congestion on S1. ETA 4h 20m.';
  if (q.includes('forecast')) answer = 'Demand forecast for next 7 days: 120, 118, 122, 125, 127, 124, 123 (tons).';
  res.json({ answer });
});

// Mock data endpoints (fallback/demo)
app.get('/mock', auth(), (req, res) => res.json(MOCK_DATA));
app.get('/plants', auth(), (req, res) => res.json(MOCK_DATA.plants));
app.get('/yards', auth(), (req, res) => res.json(MOCK_DATA.yards));
app.get('/rakes', auth(), (req, res) => res.json(MOCK_DATA.rakes));
app.get('/wagons', auth(), (req, res) => res.json(MOCK_DATA.wagons));
app.get('/dispatches', auth(), (req, res) => res.json(MOCK_DATA.dispatches));
app.get('/positions', auth(), (req, res) => res.json(MOCK_DATA.positions));

// Create rake (manager or yard)
app.post('/rakes', auth(), async (req, res) => {
  const role = req.user?.role;
  if (!['manager','yard','admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });
  const { name, destinationYard, cargoType, grade, tonnage, wagons = 0, locomotive = 'diesel', id, routeKey } = req.body || {};
  const rakeId = id || `RK${String(Math.floor(Math.random()*9000)+1000)}`;
  const rfid = `RF-${Math.floor(Math.random()*1e6).toString().padStart(6,'0')}`;
  const chosenRouteKey = (routeKey || '').toUpperCase();
  const route = (MOCK_DATA.routes.find(r => r.routeKey === chosenRouteKey)?.id)
    || (MOCK_DATA.routes.find(r => r.to === (destinationYard||'').split('-')[0])?.id)
    || 'R1';
  const created = { id: rakeId, name: name || `Rake ${rakeId.slice(-3)}`, route, status: 'Under Construction', cargoType: cargoType || 'Steel', locomotive, grade: grade || 'Fe500', tonnage: Number(tonnage||0) };
  // Update mocks
  MOCK_DATA.rakes.push(created);
  // create wagons
  for (let i=0;i<Number(wagons||0);i++) {
    const wid = `W${(Math.floor(Math.random()*900)+100).toString().padStart(3,'0')}-${rakeId.slice(-3)}`;
    MOCK_DATA.wagons.push({ id: wid, rake: rakeId, type: 'Open', cargo: cargoType || 'Steel', capacityTons: 60, loadedTons: 0 });
  }
  // seed position near Bokaro
  MOCK_DATA.positions.push({ id: rakeId, lat: 23.64 + Math.random()*0.02, lng: 86.16 + Math.random()*0.02, status: 'Under Construction', speed: 0, rfid });
  // alert
  MOCK_DATA.alerts.unshift({ id: `A${Math.floor(Math.random()*9000)+1000}`, type: 'Rake Created', message: `New rake ${rakeId} created for ${destinationYard}`, severity: 'low', ts: new Date().toISOString().slice(0,16).replace('T',' ') });
  // notify via socket
  io.emit('alert', { type: 'rake_created', rakeId, message: `New rake ${rakeId} created`, level: 'info', ts: Date.now() });

  // Persist to DB when available (best effort)
  if (prisma) {
    try {
      // find yard by name if possible, else leave null
      let yardConnect = undefined;
      if (destinationYard) {
        const y = await prisma.yard.findFirst({ where: { name: destinationYard } });
        if (y) yardConnect = { connect: { id: y.id } };
      }
      const rakeDb = await prisma.rake.create({
        data: {
          code: rakeId,
          status: 'PENDING',
          // @ts-ignore optional custom field if present in schema
          rfid,
          ...(yardConnect ? { yard: yardConnect } : {}),
        }
      });
      // create wagons
      if (Number(wagons||0) > 0) {
        const wagonData = Array.from({ length: Number(wagons||0) }, (_,i)=> ({
          code: `W${(Math.floor(Math.random()*900)+100).toString().padStart(3,'0')}-${rakeId.slice(-3)}-${i+1}`,
          type: 'general',
          capT: 60,
          rake: { connect: { id: rakeDb.id }},
        }));
        // create sequentially to avoid createMany limitations with relations
        for (const w of wagonData) { await prisma.wagon.create({ data: w }); }
      }
    } catch (e) {
      console.warn('DB persistence skipped for /rakes:', e?.message || e);
    }
  }
  res.json({ rake: created, rfid });
});

// Yard approval step: confirm creation (yard role)
app.post('/yard/confirm-creation', auth('yard'), async (req, res) => {
  const { rakeId } = req.body || {};
  if (!rakeId) return res.status(400).json({ error: 'rakeId required' });
  // update mock status
  const r = MOCK_DATA.rakes.find(r => r.id === rakeId);
  if (r) r.status = 'Loading';
  const pos = MOCK_DATA.positions.find(p => p.id === rakeId);
  if (pos) pos.status = 'Loading';
  io.emit('alert', { type: 'rake_confirmed', rakeId, message: `Rake ${rakeId} creation confirmed by yard`, level: 'info', ts: Date.now() });
  // update DB if available
  if (prisma) {
    try {
      await prisma.rake.update({ where: { code: rakeId }, data: { status: 'PENDING' } });
    } catch (e) { console.warn('DB update failed for /yard/confirm-creation:', e?.message || e); }
  }
  res.json({ ok: true });
});

// Socket.IO for realtime positions
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('chat:message', (msg) => {
    io.emit('chat:message', { ...msg, ts: Date.now(), id: crypto.randomUUID?.() || String(Date.now()) });
  });
});

// Mock IoT streamer
setInterval(() => {
  // emit mock rakes based on dataset with slight jitter
  const t = Date.now()/1000;
  const positions = MOCK_DATA.positions.map((p, idx) => ({
    id: p.id,
    lat: p.lat + Math.sin((t + idx*10)/90) * 0.004,
    lng: p.lng + Math.cos((t + idx*10)/90) * 0.004,
    speed: p.speed || 0,
    status: p.status,
  }));
  io.emit('positions', positions);
}, 3000);

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  if (!allowAll) console.log('CORS origins allowed:', CORS_ORIGINS.join(', '));
});
