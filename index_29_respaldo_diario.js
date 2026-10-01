/* SUBLICUENTAS — RESPALDO DIARIO (reemplaza el Keep manual)
   - Corre todas las noches a las 11 PM (scheduler durable, index.js).
   - Excel con: Resumen, Vencimientos 7 días, Inventario, Clientes y servicios.
   - REGLA FIJA: solo se envía a Sublicuentas y Relojes (ACL central).
     Nadie más lo recibe ni puede pedirlo con /respaldo.
   - Lee inventario y clientes UNA vez por noche (lectura barata y controlada).
*/
const fs = require("fs");
const { bot, db, ExcelJS, TZ } = require("./index_01_core");
const { hoyDMY, isFechaDMY, normalizarPlataforma, humanPlataforma, logErr } = require("./index_02_utils_roles");
const { vendedorEfectivoServicio } = require("./index_17_vendedores_servicio");
const accessControl = require("./index_23_access_control");

const DIAS_VENCIMIENTO = 7;

function dmyToDate(dmy = "") {
  if (!isFechaDMY(dmy)) return null;
  const [dd, mm, yyyy] = String(dmy).split("/").map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function fechaLocalHN() {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date()).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return { hoy: new Date(Number(p.year), Number(p.month) - 1, Number(p.day)), hora: `${p.hour}:${p.minute}` };
}

function capacidadInventario(data = {}, plat = "") {
  try {
    const { getCapacidadCorreo } = require("./index_04_inventario_correos");
    const n = Number(getCapacidadCorreo(data, plat));
    if (Number.isFinite(n) && n > 0) return n;
  } catch (_) {}
  const n = Number(data.capacidad || data.total || 0);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function pinDe(x = {}) {
  for (const k of ["pin", "pinPerfil", "pin_perfil", "PIN"]) {
    const v = x && x[k];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function estiloHoja(ws) {
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC0161D" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (ws.columnCount) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

// Una fila por perfil (si el servicio tiene varios perfiles) o una por servicio.
function filasServicios(cliente = {}) {
  const servicios = Array.isArray(cliente.servicios) ? cliente.servicios : [];
  const out = [];
  for (const s of servicios) {
    const plat = normalizarPlataforma(s.plataforma || "");
    const esTercero = String(s.beneficiarioTipo || "").trim().toLowerCase() === "tercero";
    const base = {
      cliente: cliente.nombrePerfil || cliente.nombre || "",
      telefono: cliente.telefono || "",
      plataforma: humanPlataforma ? humanPlataforma(plat) : plat,
      beneficiario: esTercero ? `Tercero: ${s.beneficiarioNombre || ""}`.trim() : "Titular",
      vendedor: (vendedorEfectivoServicio(s, cliente) || {}).vendedor || "",
      precio: Number(s.precio || 0),
      fecha: String(s.fechaRenovacion || "").trim(),
    };
    const perfiles = Array.isArray(s.perfiles) && s.perfiles.length ? s.perfiles : [null];
    for (const p of perfiles) {
      out.push({
        ...base,
        correo: String((p && p.correo) || s.correo || s.usuario || "").trim(),
        clave: String((p && p.clave) || s.clave || "").trim(),
        perfil: String((p && (p.nombre || p.perfil)) || s.perfil || s.nombrePerfil || "").trim(),
        pin: pinDe(p || {}) || pinDe(s),
      });
    }
  }
  return out;
}

async function generarRespaldoDiario() {
  const { hoy, hora } = fechaLocalHN();
  const hoyTxt = hoyDMY();
  const limite = new Date(hoy.getTime() + DIAS_VENCIMIENTO * 86400000);

  const [snapInv, snapCli] = await Promise.all([
    db.collection("inventario").get(),
    db.collection("clientes").get(),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Sublicuentas Bot"; wb.created = new Date();
  const wsRes = wb.addWorksheet("Resumen"); // primera hoja; se llena al final

  // ---------- Vencimientos + Clientes ----------
  const colsServ = [
    { header: "Renueva", key: "fecha", width: 12 }, { header: "Cliente", key: "cliente", width: 26 },
    { header: "Teléfono", key: "telefono", width: 15 }, { header: "Plataforma", key: "plataforma", width: 18 },
    { header: "Correo / Usuario", key: "correo", width: 30 }, { header: "Clave", key: "clave", width: 16 },
    { header: "Perfil", key: "perfil", width: 16 }, { header: "PIN", key: "pin", width: 8 },
    { header: "Precio", key: "precio", width: 10 }, { header: "Vendedor", key: "vendedor", width: 16 },
    { header: "Titular / Tercero", key: "beneficiario", width: 22 },
  ];
  const todas = [];
  snapCli.forEach((d) => todas.push(...filasServicios({ id: d.id, ...(d.data() || {}) })));

  const ordenFecha = (a, b) => ((dmyToDate(a.fecha)?.getTime() || Infinity) - (dmyToDate(b.fecha)?.getTime() || Infinity))
    || String(a.cliente).localeCompare(String(b.cliente), "es");

  const vencidos = [], proximos = [];
  for (const r of todas) {
    const f = dmyToDate(r.fecha);
    if (!f) continue;
    if (f < hoy) vencidos.push(r);
    else if (f <= limite) proximos.push(r);
  }

  const wsVen = wb.addWorksheet(`Vencen ${DIAS_VENCIMIENTO} días`);
  wsVen.columns = colsServ;
  proximos.sort(ordenFecha).forEach((r) => wsVen.addRow(r));
  estiloHoja(wsVen);

  const wsAtr = wb.addWorksheet("Vencidos");
  wsAtr.columns = colsServ;
  vencidos.sort(ordenFecha).forEach((r) => wsAtr.addRow(r));
  estiloHoja(wsAtr);

  // ---------- Inventario ----------
  const wsInv = wb.addWorksheet("Inventario");
  wsInv.columns = [
    { header: "Plataforma", key: "plataforma", width: 18 }, { header: "Correo / Usuario", key: "correo", width: 32 },
    { header: "Clave", key: "clave", width: 18 }, { header: "PIN", key: "pin", width: 8 },
    { header: "Capacidad", key: "capacidad", width: 10 }, { header: "Ocupados", key: "ocupados", width: 10 },
    { header: "Libres", key: "libres", width: 8 }, { header: "Clientes en la cuenta (nombre · PIN)", key: "clientes", width: 60 },
  ];
  const invRows = [];
  let totalLibres = 0;
  snapInv.forEach((d) => {
    const x = d.data() || {};
    const plat = normalizarPlataforma(x.plataforma || "");
    const clientes = Array.isArray(x.clientes) ? x.clientes : [];
    const capacidad = capacidadInventario(x, plat);
    const ocupados = clientes.length;
    const libres = Math.max(0, capacidad - ocupados);
    totalLibres += libres;
    invRows.push({
      plataforma: humanPlataforma ? humanPlataforma(plat) : plat,
      correo: String(x.correo || x.usuario || x.ident || "").trim(),
      clave: String(x.clave || "").trim(),
      pin: pinDe(x),
      capacidad, ocupados, libres,
      clientes: clientes.map((c) => [c?.nombre, pinDe(c || {})].filter(Boolean).join(" · ")).join(" | "),
    });
  });
  invRows.sort((a, b) => a.plataforma.localeCompare(b.plataforma, "es") || a.correo.localeCompare(b.correo, "es"));
  invRows.forEach((r) => wsInv.addRow(r));
  estiloHoja(wsInv);

  // ---------- Clientes y servicios (todo) ----------
  const wsCli = wb.addWorksheet("Clientes y servicios");
  wsCli.columns = colsServ;
  todas.slice().sort((a, b) => String(a.cliente).localeCompare(String(b.cliente), "es")).forEach((r) => wsCli.addRow(r));
  estiloHoja(wsCli);

  // ---------- Resumen (primera hoja) ----------
  wsRes.columns = [{ header: "Dato", key: "k", width: 34 }, { header: "Valor", key: "v", width: 22 }];
  [
    ["Respaldo generado", `${hoyTxt} ${hora}`],
    ["Cuentas en inventario", invRows.length],
    ["Perfiles libres", totalLibres],
    ["Clientes registrados", snapCli.size],
    ["Servicios / perfiles activos", todas.length],
    [`Vencen en ${DIAS_VENCIMIENTO} días`, proximos.length],
    ["Vencidos sin renovar", vencidos.length],
  ].forEach(([k, v]) => wsRes.addRow({ k, v }));
  estiloHoja(wsRes);

  const tempPath = `/tmp/respaldo_${hoyTxt.replace(/\//g, "-")}_${Date.now()}.xlsx`;
  await wb.xlsx.writeFile(tempPath);

  return {
    tempPath, hoyTxt, hora,
    stats: { cuentas: invRows.length, libres: totalLibres, clientes: snapCli.size, servicios: todas.length, proximos: proximos.length, vencidos: vencidos.length },
  };
}

function textoResumen(r) {
  const s = r.stats;
  return [
    `🗄️ RESPALDO DIARIO — ${r.hoyTxt} ${r.hora}`,
    "",
    `📦 Cuentas en inventario: ${s.cuentas} (${s.libres} perfiles libres)`,
    `👥 Clientes: ${s.clientes} · Servicios: ${s.servicios}`,
    `⏰ Vencen en ${DIAS_VENCIMIENTO} días: ${s.proximos}`,
    `⚠️ Vencidos sin renovar: ${s.vencidos}`,
    "",
    "Si se cae el bot o el internet del sistema, abrí este Excel y seguí trabajando.",
  ].join("\n");
}

async function destinatariosAutorizados() {
  // REGLA FIJA: solo Sublicuentas y Relojes. Misma fuente que el backup dominical.
  const ids = await accessControl.getBackupRecipientChatIds();
  return [...new Set((ids || []).map(String))];
}

async function enviarRespaldo(destinos = []) {
  if (!destinos.length) throw new Error("respaldo_sin_destinatarios_autorizados");
  const r = await generarRespaldoDiario();
  let enviados = 0;
  try {
    for (const tg of destinos) {
      try {
        await bot.sendDocument(tg, r.tempPath, { caption: textoResumen(r) }, {
          filename: `Respaldo_Sublicuentas_${r.hoyTxt.replace(/\//g, "-")}.xlsx`,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        enviados++;
      } catch (e) { logErr(`respaldo:${tg}`, e); }
    }
  } finally {
    try { fs.unlinkSync(r.tempPath); } catch (_) {}
  }
  return { ok: enviados > 0, enviados, destinatarios: destinos.length, fecha: r.hoyTxt, stats: r.stats };
}

// Tarea nocturna (scheduler durable)
async function ejecutarRespaldoDiario() {
  try {
    const res = await enviarRespaldo(await destinatariosAutorizados());
    console.log(`✅ Respaldo diario enviado a ${res.enviados}/${res.destinatarios}`);
    return res;
  } catch (e) {
    logErr("ejecutarRespaldoDiario", e);
    return { ok: false, error: String(e?.message || e) };
  }
}

// Manual: /respaldo — solo Sublicuentas y Relojes, y solo en chat privado.
const enCurso = new Set();
bot.onText(/^\/respaldo(?:@\w+)?\s*$/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id || "");
  try {
    const autorizados = await destinatariosAutorizados();
    if (msg.chat.type !== "private" || !autorizados.includes(userId)) {
      return bot.sendMessage(chatId, "⛔ No tenés acceso a esta función.");
    }
    if (enCurso.has(userId)) return bot.sendMessage(chatId, "⏳ Ya estoy generando tu respaldo…");
    enCurso.add(userId);
    await bot.sendMessage(chatId, "⏳ Generando respaldo…");
    const res = await enviarRespaldo([userId]);
    if (!res.ok) await bot.sendMessage(chatId, "⚠️ No pude enviar el respaldo. Intentá de nuevo.");
  } catch (e) {
    logErr("/respaldo", e);
    bot.sendMessage(chatId, "⚠️ Error generando el respaldo.").catch(() => {});
  } finally {
    enCurso.delete(userId);
  }
});

module.exports = { ejecutarRespaldoDiario, generarRespaldoDiario };
