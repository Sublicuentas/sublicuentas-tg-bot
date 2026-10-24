"use strict";
// index_35_push_cobros.js · Fase 2 · Oct-2026 · Aviso push de cobros (7 AM y 7 PM) desde el servidor.
// Reemplaza el recordatorio local de la APK en los teléfonos con push activo (la APK deja de programar
// el suyo para que no lleguen dos). Mismas reglas que la APK (recordatorios.js):
//   · 7:00 AM → "💰 Hoy toca cobrar a N" · total · además N vencidos sin gestionar
//   · 7:00 PM → "📅 Mañana vencen N"
//   · Cada usuario SOLO sus cobros (Sublicuentas los de Sublicuentas, Relojes los de Relojes, Geisell los suyos).
//   · Un cobro = cliente (o tercero) + fecha + vendedor, igual que la pantalla Cobros.
// Ventaja: sale con los datos al día aunque el teléfono no haya abierto la app.
// El aviso no lleva nombres de clientes, correos ni claves: solo cantidades y total.

const MS_DIA = 86400000;

function normTxt(v) { return String(v == null ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); }
function vendedorClave(v) { const k = normTxt(v); return k === "geissel" ? "geisell" : k; }
function dmyATs(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return NaN;
}
function money(n) { const v = Math.round((Number(n) || 0) * 100) / 100; return `L${v.toLocaleString("en-US", Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
const clientes = (n) => `${n} cliente${n === 1 ? "" : "s"}`;

// Cobros agrupados por vendedor: { [vendedor]: Map(key → { ts, total }) }. Función pura (se prueba sin Firestore).
function cobrosPorVendedor(docsClientes = []) {
  const out = new Map();
  for (const { id, data } of docsClientes) {
    const c = data || {};
    if (String(c.consolidadoEn || "").trim()) continue;
    for (const s of Array.isArray(c.servicios) ? c.servicios : []) {
      if (!s) continue;
      const ts = dmyATs(s.fechaRenovacion);
      if (!Number.isFinite(ts)) continue;
      const vend = vendedorClave(s.vendedor || c.vendedor || "");
      if (!vend) continue;
      const tercero = normTxt(s.beneficiarioTipo) === "tercero" ? normTxt(s.beneficiarioNombre || s.beneficiario) : "";
      const key = `${id}|${tercero}|${ts}`;
      if (!out.has(vend)) out.set(vend, new Map());
      const g = out.get(vend).get(key) || { ts, total: 0 };
      g.total += Number(s.precio || 0) || 0;
      out.get(vend).set(key, g);
    }
  }
  return out;
}

// Texto del aviso para un vendedor. tipo 'hoy' (7 AM) o 'manana' (7 PM). hoyTs = medianoche UTC del día local.
function avisoCobros(grupos, tipo, hoyTs) {
  const lista = grupos ? [...grupos.values()] : [];
  if (tipo === "manana") {
    const m = lista.filter((g) => g.ts === hoyTs + MS_DIA);
    if (!m.length) return null;
    const total = m.reduce((t, g) => t + g.total, 0);
    return { titulo: `📅 Mañana vencen ${m.length}`, cuerpo: `Mañana toca cobrar a ${clientes(m.length)} · ${money(total)}. Toque para verlos.`, data: { tipo: "cobros", ir: "renovar", tab: "proximo" } };
  }
  const hoy = lista.filter((g) => g.ts === hoyTs);
  const venc = lista.filter((g) => g.ts < hoyTs).length;
  const extra = venc ? ` · además ${venc} vencido${venc === 1 ? "" : "s"} sin gestionar` : "";
  if (hoy.length) {
    const total = hoy.reduce((t, g) => t + g.total, 0);
    return { titulo: `💰 Hoy toca cobrar a ${clientes(hoy.length)}`, cuerpo: `Total por cobrar hoy: ${money(total)}${extra}. Toque para abrir Cobros.`, data: { tipo: "cobros", ir: "renovar", tab: "hoy" } };
  }
  if (venc) return { titulo: `⚠️ ${venc} vencido${venc === 1 ? "" : "s"} sin gestionar`, cuerpo: "Hoy no vence nadie, pero quedan cobros atrasados. Toque para verlos.", data: { tipo: "cobros", ir: "renovar", tab: "vencidos" } };
  return null;
}

// Job del scheduler durable. tipo: 'hoy' | 'manana'. scheduledDateDMY = día local (dd/mm/yyyy).
async function enviarPushCobros({ db, admin, tipo, scheduledDateDMY, horaLimite = 24, horaActual = null }) {
  // Si el bot estuvo apagado, no se manda "Hoy toca cobrar" en la tarde ni "Mañana vencen" de madrugada.
  if (horaActual != null && horaActual >= horaLimite) return { ok: true, omitido: "fuera_de_hora" };
  const push = require("./lib_push");
  const grupos = await push.gruposConCobros(db);
  if (!grupos.length) return { ok: true, enviados: 0 };
  const snap = await require("./index_30_espejo_firestore").getColeccion("clientes");
  const docs = []; snap.forEach((d) => docs.push({ id: d.id, data: d.data() || {} }));
  const porVend = cobrosPorVendedor(docs);
  const hoyTs = dmyATs(scheduledDateDMY);
  let enviados = 0;
  for (const grupo of grupos) {
    const aviso = avisoCobros(porVend.get(vendedorClave(grupo)), tipo, hoyTs);
    if (!aviso) continue;
    const r = await push.avisar(db, admin, { usuarios: [grupo], soloCobros: true, ...aviso });
    enviados += Number(r?.enviados || 0);
  }
  return { ok: true, enviados };
}

module.exports = { cobrosPorVendedor, avisoCobros, enviarPushCobros, dmyATs };
