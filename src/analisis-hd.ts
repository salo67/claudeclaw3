/**
 * /analisis-hd — Home Depot analytics via Telegram.
 * Pulls from HD Cientifico API (port 8002).
 */

const HD_API = 'http://127.0.0.1:8002/api';

async function hdApi<T>(path: string): Promise<T> {
  const res = await fetch(`${HD_API}${path}`);
  if (!res.ok) throw new Error(`HD API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────

interface KPIs {
  comps_pct: number;
  ventas_ytd: number;
  ventas_lytd: number;
  productos_con_hueco: number;
  total_huecos: number;
}

interface Stockout {
  modelo: string;
  inventario: number;
  tiendas_con_hueco: number;
  tiendas_activas: number;
}

interface TopProduct {
  modelo: string;
  ventas: number;
  ventasLYTD: number;
  growth: number;
}

interface ModelSummary {
  modelo: string;
  ventas_ytd: number;
  ventas_lytd: number;
  growth: number;
  inventario: number;
  tiendas_activas: number;
  tiendas_con_hueco: number;
  [key: string]: unknown;
}

// ── Formatters ───────────────────────────────────────────────

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

// ── Commands ─────────────────────────────────────────────────

export async function hdResumen(): Promise<string> {
  const kpis = await hdApi<KPIs>('/kpis');
  const stockouts = await hdApi<Stockout[]>('/stockouts');
  const top = await hdApi<TopProduct[]>('/products/top');

  const worstStockout = stockouts
    .sort((a, b) => b.tiendas_con_hueco - a.tiendas_con_hueco)[0];

  const top3 = top.slice(0, 3).map(
    (p) => `  ${p.modelo}: ${fmtMoney(p.ventas)} (${fmtPct(p.growth)})`
  ).join('\n');

  return [
    '📊 HD Resumen',
    '',
    `Ventas YTD: ${fmtMoney(kpis.ventas_ytd)}`,
    `Comps: ${fmtPct(kpis.comps_pct)}`,
    `Huecos: ${kpis.total_huecos} en ${kpis.productos_con_hueco} modelos`,
    '',
    'Top productos:',
    top3,
    '',
    worstStockout
      ? `⚠ Peor stockout: ${worstStockout.modelo} (${worstStockout.tiendas_con_hueco}/${worstStockout.tiendas_activas} tiendas sin stock)`
      : '',
  ].filter(Boolean).join('\n');
}

export async function hdStockouts(): Promise<string> {
  const stockouts = await hdApi<Stockout[]>('/stockouts');
  if (stockouts.length === 0) return '✅ Sin stockouts activos.';

  const sorted = stockouts.sort((a, b) => b.tiendas_con_hueco - a.tiendas_con_hueco);
  const lines = sorted.slice(0, 15).map((s) => {
    const pct = ((s.tiendas_con_hueco / s.tiendas_activas) * 100).toFixed(0);
    return `${s.modelo}: ${s.tiendas_con_hueco}/${s.tiendas_activas} tiendas (${pct}%) | inv: ${s.inventario}`;
  });

  return [
    `⚠ Stockouts: ${stockouts.length} modelos`,
    '',
    ...lines,
    stockouts.length > 15 ? `\n... y ${stockouts.length - 15} más` : '',
  ].filter(Boolean).join('\n');
}

export async function hdTop(): Promise<string> {
  const top = await hdApi<TopProduct[]>('/products/top');
  if (top.length === 0) return 'Sin datos de productos.';

  const lines = top.slice(0, 10).map((p, i) => {
    return `${i + 1}. ${p.modelo}: ${fmtMoney(p.ventas)} (${fmtPct(p.growth)})`;
  });

  return ['🏆 Top 10 productos', '', ...lines].join('\n');
}

export async function hdModelo(modelo: string): Promise<string> {
  try {
    const summary = await hdApi<ModelSummary>(`/models/${encodeURIComponent(modelo)}/summary`);
    return [
      `🔍 ${summary.modelo}`,
      '',
      `Ventas YTD: ${fmtMoney(summary.ventas_ytd)}`,
      `Ventas LYTD: ${fmtMoney(summary.ventas_lytd)}`,
      `Growth: ${fmtPct(summary.growth)}`,
      `Inventario: ${summary.inventario}`,
      `Tiendas activas: ${summary.tiendas_activas}`,
      summary.tiendas_con_hueco > 0
        ? `⚠ Tiendas sin stock: ${summary.tiendas_con_hueco}`
        : '✅ Sin huecos',
    ].join('\n');
  } catch {
    // Try search
    const results = await hdApi<{ modelo: string }[]>(`/models/search?q=${encodeURIComponent(modelo)}`);
    if (results.length === 0) return `No encontré el modelo "${modelo}".`;
    const matches = results.slice(0, 5).map((r) => r.modelo).join(', ');
    return `No encontré "${modelo}" exacto. Coincidencias: ${matches}`;
  }
}

export async function hdInsightData(): Promise<string> {
  const kpis = await hdApi<KPIs>('/kpis');
  const stockouts = await hdApi<Stockout[]>('/stockouts');
  const top = await hdApi<TopProduct[]>('/products/top');

  return JSON.stringify({ kpis, stockouts: stockouts.slice(0, 10), top_products: top }, null, 2);
}
