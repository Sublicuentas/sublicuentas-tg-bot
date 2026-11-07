"use strict";
// R185 · Portal de Socios (guía maestra 07/11/2026) · utilidades SOLO DE LECTURA para la API del panel.
// - Periodo YYYY-MM para avisos por mes/año y métricas por mes.
// - Límite del historial de pedidos.
// - Meta mensual del socio tal como la guarda Sublicuentas en revendedores/{id} (no se inventa ni se calcula).

const PERIODO_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function periodoValido(v) {
  const m = PERIODO_RE.exec(String(v || "").trim());
  if (!m) return null;
  const y = Number(m[1]), mes = Number(m[2]);
  if (y < 2020 || y > 2100) return null;
  return { y, m: mes, txt: `${m[1]}-${m[2]}` };
}

// Rango del mes en hora de Honduras (UTC-6, sin horario de verano): [inicio, fin)
function rangoMesHonduras(per) {
  const p = typeof per === "string" ? periodoValido(per) : per;
  if (!p) return null;
  return { desde: new Date(Date.UTC(p.y, p.m - 1, 1, 6)), hasta: new Date(Date.UTC(p.y, p.m, 1, 6)) };
}

// Rango del mes con la MISMA convención que ya usa /rev/metricas para el mes actual (hora del servidor).
function rangoMesServidor(per) {
  const p = typeof per === "string" ? periodoValido(per) : per;
  if (!p) return null;
  return { desde: new Date(p.y, p.m - 1, 1).getTime(), hasta: new Date(p.y, p.m, 1).getTime() };
}

function limiteHistorial(q, porDefecto = 20, maximo = 500) {
  const n = Math.floor(Number(q));
  if (!Number.isFinite(n) || n < 1) return porDefecto;
  return Math.min(maximo, n);
}

// Solo números positivos; "YYYY-MM" válido. 0 o vacío = sin meta (el panel muestra "Meta no configurada").
function metasPublicas(perfil = {}) {
  const out = {};
  const tabla = perfil && typeof perfil.metas === "object" && perfil.metas ? perfil.metas : {};
  for (const [k, v] of Object.entries(tabla)) {
    if (!periodoValido(k)) continue;
    const n = Number(v && typeof v === "object" ? (v.monto ?? v.objetivo) : v);
    if (Number.isFinite(n) && n > 0) out[k] = Math.round(n * 100) / 100;
  }
  const mm = Number(perfil?.metaMensual);
  return { metas: out, metaMensual: Number.isFinite(mm) && mm > 0 ? Math.round(mm * 100) / 100 : null };
}

module.exports = { periodoValido, rangoMesHonduras, rangoMesServidor, limiteHistorial, metasPublicas };
