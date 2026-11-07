"use strict";
// R186 · Motor ÚNICO de fechas de renovación (PDF «Sublichat 5 puntos», bloque 02, 07/11/2026).
// COPIA FIEL de Sublichat HQ api/_renovacion-motor.js (misma lógica, mismos vectores tests/renovacion-vectores.json).
// Si se cambia una regla, se cambia en los dos y en los vectores.
//
// Reglas aprobadas por Sublicuentas:
//   · Siempre desde la FECHA DE VENCIMIENTO (nunca desde el día del pago). Fecha de pago ≠ vencimiento.
//   · "+31 días" = 31 días exactos · "+N días" = N días exactos.
//   · "1 mes" = 30 días exactos (regla del negocio, se conserva).
//   · 2, 3, 6, 12… meses = meses CALENDARIO: 04 nov + 3 meses = 04 feb.
//     Si el día no existe en el mes destino (29/30/31) → último día de ese mes, y se guarda el día
//     original (diaAncla) para volver a él después: 31 ene + 2 m = 31 mar; 30 nov + 3 m = 28 feb → luego 30 may.
//   · Renovación por días reinicia el día ancla al día de la nueva fecha (así no "salta" en la siguiente).
// Fechas civiles DD/MM/AAAA (sin zona horaria: no se corren por UTC).

const RE_DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const RE_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, "0");
function diasDelMes(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m = 1..12

function leerFecha(v) {
  const s = String(v == null ? "" : v).trim();
  let y, m, d, x;
  if ((x = RE_DMY.exec(s))) { d = +x[1]; m = +x[2]; y = +x[3]; }
  else if ((x = RE_YMD.exec(s))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else return null;
  if (y < 2000 || y > 2200 || m < 1 || m > 12 || d < 1 || d > diasDelMes(y, m)) return null;
  return { y, m, d };
}
function aDMY({ y, m, d }) { return `${pad(d)}/${pad(m)}/${y}`; }
function aYMD({ y, m, d }) { return `${y}-${pad(m)}-${pad(d)}`; }
function sumarDiasCivil(f, n) { const t = new Date(Date.UTC(f.y, f.m - 1, f.d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
function diasEntre(a, b) { return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000); }

// El ancla solo vale si la fecha actual es esa misma (o su versión recortada al fin de mes).
function anclaEfectiva(f, diaAncla) {
  const a = Math.round(Number(diaAncla));
  if (!Number.isInteger(a) || a < 1 || a > 31) return f.d;
  if (a === f.d) return a;
  if (a > f.d && f.d === diasDelMes(f.y, f.m)) return a;
  return f.d;
}

/**
 * @param {string} fecha  vencimiento actual (DD/MM/AAAA o AAAA-MM-DD)
 * @param {{unidad:'dias'|'meses', cantidad:number, diaAncla?:number}} periodo
 * @returns {{fechaNueva:string, ymd:string, diaAncla:number, regla:'dias'|'1mes_30dias'|'meses_calendario', dias:number}}
 */
function sumarPeriodo(fecha, periodo = {}) {
  const f = leerFecha(fecha);
  if (!f) throw new Error("Fecha de vencimiento inválida.");
  const unidad = String(periodo.unidad || "").toLowerCase() === "dias" ? "dias" : "meses";
  const n = Math.round(Number(periodo.cantidad));
  if (!Number.isInteger(n) || n < 1 || n > (unidad === "dias" ? 730 : 24)) throw new Error(unidad === "dias" ? "Use 1 a 730 días." : "Use 1 a 24 meses.");
  let nueva, regla, ancla;
  if (unidad === "dias" || n === 1) {
    nueva = sumarDiasCivil(f, unidad === "dias" ? n : 30);
    regla = unidad === "dias" ? "dias" : "1mes_30dias";
    ancla = nueva.d;
  } else {
    ancla = anclaEfectiva(f, periodo.diaAncla);
    const idx = f.y * 12 + (f.m - 1) + n;
    const y = Math.floor(idx / 12), m = (idx % 12) + 1;
    nueva = { y, m, d: Math.min(ancla, diasDelMes(y, m)) };
    regla = "meses_calendario";
  }
  return { fechaNueva: aDMY(nueva), ymd: aYMD(nueva), diaAncla: ancla, regla, dias: diasEntre(f, nueva) };
}

// Aplica k periodos seguidos (para renovaciones muy atrasadas con confirmación explícita de cuántos periodos).
function sumarPeriodos(fecha, periodo, veces = 1) {
  let r = { fechaNueva: fecha, diaAncla: periodo.diaAncla };
  const k = Math.max(1, Math.min(24, Math.round(Number(veces) || 1)));
  for (let i = 0; i < k; i++) r = sumarPeriodo(r.fechaNueva, { ...periodo, diaAncla: r.diaAncla });
  return r;
}

// ¿La nueva fecha sigue vencida respecto a hoy? → el canal debe pedir confirmación de cuántos periodos cobra.
function sigueVencida(fechaNuevaDMY, hoyDMY) {
  const a = leerFecha(fechaNuevaDMY), b = leerFecha(hoyDMY);
  return !!(a && b && diasEntre(b, a) < 0);
}

// Montos exactos: todo en centavos enteros.
function aCentavos(v) {
  const s = String(v == null ? "" : v).replace(/[^0-9.\-]/g, "");
  if (!s || isNaN(Number(s))) return NaN;
  const neg = s.startsWith("-"), [ent, dec = ""] = s.replace("-", "").split(".");
  return (neg ? -1 : 1) * (Number(ent || 0) * 100 + Number((dec + "00").slice(0, 2)));
}
function deCentavos(c) { return Math.round(Number(c) || 0) / 100; }

module.exports = { leerFecha, aDMY, aYMD, diasEntre, sumarPeriodo, sumarPeriodos, sigueVencida, aCentavos, deCentavos };
