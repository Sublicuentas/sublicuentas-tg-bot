"use strict";
/* =====================================================================================================
   R213 · Mensaje del día (Portal de Socios · Inicio). PDF «Inicio + Mensaje del día», 24/11/2026.
   · Un mensaje por día calendario de Honduras (America/Tegucigalpa, UTC−6 todo el año).
   · Mismo texto para todos los socios y dispositivos durante ese día: se decide AQUÍ (servidor), nunca al azar.
   · Fuente 1: mensajes programados por administración en `mensajes_dia/{YYYY-MM-DD}` (estado «publicado»).
   · Fuente 2 (respaldo): banco fijo de frases, elegido por número de día → días seguidos nunca repiten y
     no se repite ninguna hasta recorrer todo el banco. Al usar respaldo se deja una alerta administrativa
     (`mensajes_dia_alertas/{fecha}`, una sola vez por día).
   · Solo texto plano: se rechaza «<» y «>» al guardar; el panel lo muestra con textContent.
   ===================================================================================================== */
const COL = "mensajes_dia";
const COL_ALERTA = "mensajes_dia_alertas";
const MIN = 10, MAX = 220;
const BANCO = Object.freeze([
  "Cada renovación fortalece la confianza de un cliente. Cada nueva venta abre una oportunidad de crecer.",
  "La constancia de hoy crea las oportunidades comerciales de mañana. Un mensaje a tiempo puede ser una venta.",
  "Un cliente bien atendido vuelve y además recomienda. Responda rápido, explique claro y cumpla lo prometido.",
  "Revise hoy quién vence esta semana: recordar a tiempo es servicio, no presión, y asegura su renovación.",
  "Las ventas grandes empiezan con conversaciones pequeñas. Salude, pregunte qué necesita y ofrezca la mejor opción.",
  "Su cartera de clientes es su negocio. Cuídela con atención, puntualidad y soluciones cuando algo falle.",
  "Un buen seguimiento vale más que mil anuncios. Escriba hoy a ese cliente que quedó pensándolo.",
  "La confianza se gana entrega por entrega. Hagamos que cada cliente sienta que eligió bien.",
  "Hoy es un gran día para ofrecer un combo: más servicios para el cliente y más ventas para usted.",
  "Atender con paciencia convierte una duda en una compra. Explique con calma y deje todo claro.",
  "Cada cliente que renueva confía en su servicio. Agradézcale y recuérdele que está para ayudarle.",
  "Organice su día: primero renovaciones por vencer, luego clientes nuevos y al final seguimiento de pendientes.",
  "Las metas se cumplen sumando pequeños logros. Una venta más hoy es un paso más hacia su objetivo.",
  "Una respuesta rápida transmite seriedad. Conteste a sus clientes lo antes posible, aunque sea para confirmar.",
  "Escuche primero y ofrezca después. Cuando entiende lo que el cliente busca, la venta llega sola.",
  "No espere al último día: avisar con tiempo una renovación evita cortes y mantiene clientes felices.",
  "Su mejor publicidad es un cliente satisfecho. Pídale con amabilidad que lo recomiende con sus conocidos.",
  "Un cliente que no responde hoy puede comprar mañana. Mantenga el contacto con respeto y constancia.",
  "La disciplina diaria construye negocios estables. Revise su cartera, anote pendientes y cumpla cada compromiso.",
  "Ofrezca soluciones, no solo productos. Pregunte en qué dispositivo verá y recomiende el plan correcto.",
  "Celebre cada venta, por pequeña que sea. Cada cliente nuevo es una relación que puede durar años.",
  "La honestidad vende más que la prisa. Explique condiciones claras y evitará reclamos después.",
  "Un buen día de ventas empieza temprano. Envíe hoy sus recordatorios antes del mediodía.",
  "Cuando un cliente tiene un problema, su ayuda rápida se convierte en lealtad para muchos meses.",
  "Comparta el catálogo con clientes que aún no conocen todos los servicios. Una sugerencia puede ser una venta.",
  "La renovación es la venta más fácil: el cliente ya confía. Escríbale antes de que venza.",
  "Mida su avance cada semana. Saber cuánto vendió le ayuda a decidir qué hacer mejor.",
  "Sea el contacto que siempre responde. En un negocio de servicio, la presencia marca la diferencia.",
  "Cada no de hoy le acerca al sí de mañana. Siga ofreciendo con amabilidad y buena actitud.",
  "Un mensaje personalizado vale más que uno masivo. Llame al cliente por su nombre y recuerde lo que usa.",
  "Mantenga sus datos al día: teléfonos correctos y fechas exactas evitan pérdidas de clientes.",
  "Hoy puede ser el día de su mejor venta del mes. Revise sus contactos y haga una oferta clara.",
  "Las personas compran a quien les inspira confianza. Sea puntual, amable y claro en cada respuesta.",
  "Agradecer cada pago es parte del servicio. Un gracias sincero hace que el cliente quiera volver.",
  "Busque un cliente nuevo cada día. Con constancia, su cartera crecerá más de lo que imagina.",
  "Antes de despedirse, pregunte si necesita algo más. Muchas ventas adicionales nacen de esa pregunta.",
  "Su trabajo de hoy sostiene los ingresos de mañana. Atienda cada renovación como si fuera la primera venta.",
  "Una buena actitud se nota hasta por mensaje. Escriba con respeto, claridad y una sonrisa.",
  "Ordene sus pendientes, termine lo que empezó y deje a cada cliente con su servicio funcionando.",
  "La calidad del servicio es su mejor argumento de venta. Cumpla siempre lo que ofrece.",
  "Recuerde: un cliente atendido a tiempo es un cliente que renueva. Revise hoy sus vencimientos.",
  "Las oportunidades están en su lista de contactos. Hoy escriba a tres personas que aún no le compran.",
  "Explique cada plan con sencillez. Cuando el cliente entiende lo que compra, compra con confianza.",
  "Un socio constante vende más que uno con suerte. Haga hoy su rutina de ventas completa.",
  "Cada cliente es distinto: adapte su oferta a lo que de verdad necesita y ganará su preferencia.",
  "Termine el día revisando qué funcionó. Repita lo bueno mañana y mejore lo que faltó.",
  "Un reclamo bien resuelto vale más que diez ventas rápidas. Escuche, solucione y dé seguimiento.",
  "Su esfuerzo de cada día suma. Siga atendiendo bien, que los resultados llegan con constancia.",
  "Ofrezca renovar por más meses a clientes fieles: ahorran tiempo y usted asegura su venta.",
  "Comience la semana con orden: lista de vencimientos, clientes por contactar y metas claras.",
  "La puntualidad en las entregas habla de su seriedad. Confirme con el cliente cuando todo esté listo.",
  "Hoy es buen día para retomar clientes que dejaron de comprar. Un saludo amable puede reactivarlos.",
  "Venda con el ejemplo: use, conozca y recomiende los servicios con seguridad y conocimiento.",
  "Los clientes recuerdan cómo los hizo sentir. Haga que cada conversación sea agradable y útil.",
  "Una cartera sana se cuida a diario. Revise, recuerde y renueve a tiempo cada servicio.",
  "No subestime una consulta pequeña: detrás de una pregunta puede estar su próxima venta.",
  "Su crecimiento depende de su constancia. Un poco cada día construye un gran negocio.",
  "Comparta novedades con sus clientes: un servicio nuevo puede ser justo lo que estaban buscando.",
  "La confianza del cliente es su mayor capital. Protéjala con honestidad y buen servicio.",
  "Cierre el día con sus pendientes resueltos. Mañana empezará con más tiempo para vender.",
]);

/** Fecha de Honduras (UTC−6, sin horario de verano) como YYYY-MM-DD. */
function fechaHN(d = new Date()) {
  const t = new Date(d.getTime() - 6 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const valida = (f) => FECHA_RE.test(String(f || "")) && !Number.isNaN(Date.parse(f + "T00:00:00Z"));
/** Número de día (estable) → mensaje del banco. Días consecutivos siempre distintos. */
function respaldo(fecha) {
  const dia = Math.floor(Date.parse(fecha + "T00:00:00Z") / 86400000);
  return BANCO[((dia % BANCO.length) + BANCO.length) % BANCO.length];
}
function limpiarTexto(v) {
  const t = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (/[<>]/.test(t)) return { error: "texto_invalido", detail: "El mensaje no puede llevar < ni >." };
  if (t.length < MIN) return { error: "texto_corto", detail: `Escriba al menos ${MIN} caracteres.` };
  if (t.length > MAX) return { error: "texto_largo", detail: `Máximo ${MAX} caracteres (recomendado: 15 a 22 palabras).` };
  return { texto: t, palabras: t.split(" ").length };
}

/** Mensaje vigente para la fecha (por defecto hoy en Honduras). */
async function delDia(db, { fecha = fechaHN(), alertar = true } = {}) {
  if (!valida(fecha)) throw Object.assign(new Error("fecha_invalida"), { status: 400 });
  const snap = await db.collection(COL).doc(fecha).get();
  const d = snap.exists ? snap.data() || {} : null;
  if (d && d.estado === "publicado" && String(d.texto || "").trim()) return { fecha, texto: String(d.texto).trim(), fuente: "programado" };
  if (alertar) {
    try { await db.collection(COL_ALERTA).doc(fecha).create({ fecha, motivo: d ? `estado_${d.estado || "sin_texto"}` : "sin_mensaje_programado", createdAt: new Date() }); }
    catch (e) { if (!(e && (e.code === 6 || /already exists/i.test(String(e.message))))) console.error("mensaje_dia alerta", e?.message || e); }
  }
  return { fecha, texto: respaldo(fecha), fuente: "respaldo" };
}

/** Panel Dios / HQ: próximos N días con lo que se mostrará y si es programado o respaldo. */
async function agenda(db, { desde = fechaHN(), dias = 14 } = {}) {
  if (!valida(desde)) throw Object.assign(new Error("fecha_invalida"), { status: 400 });
  const n = Math.max(1, Math.min(60, Number(dias) || 14));
  const fechas = Array.from({ length: n }, (_, i) => new Date(Date.parse(desde + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10));
  const snaps = await Promise.all(fechas.map((f) => db.collection(COL).doc(f).get()));
  return fechas.map((f, i) => {
    const d = snaps[i].exists ? snaps[i].data() || {} : null;
    const prog = d && d.estado === "publicado" && d.texto;
    return { fecha: f, texto: prog ? d.texto : respaldo(f), fuente: prog ? "programado" : "respaldo", estado: d ? d.estado || "" : "", programado: d ? { texto: d.texto || "", estado: d.estado || "", autor: d.autor || "", publicadoAt: d.publicadoAt || null } : null };
  });
}
async function guardar(db, fecha, { texto, estado = "publicado" } = {}, autor = "Admin") {
  if (!valida(fecha)) return { status: 400, error: "fecha_invalida" };
  if (!["publicado", "borrador", "retirado"].includes(estado)) return { status: 400, error: "estado_invalido" };
  const ref = db.collection(COL).doc(fecha);
  if (estado === "retirado") {
    const s = await ref.get(); if (!s.exists) return { status: 404, error: "no_existe" };
    await ref.set({ estado: "retirado", retiradoAt: new Date(), retiradoPor: String(autor).slice(0, 80) }, { merge: true });
    return { status: 200, ok: true, fecha, estado: "retirado" };
  }
  const v = limpiarTexto(texto); if (v.error) return { status: 400, ...v };
  await ref.set({ fecha, texto: v.texto, estado, autor: String(autor).slice(0, 80), publicadoAt: estado === "publicado" ? new Date() : null, updatedAt: new Date() }, { merge: true });
  return { status: 200, ok: true, fecha, estado, texto: v.texto, palabras: v.palabras };
}

module.exports = { BANCO, fechaHN, respaldo, limpiarTexto, delDia, agenda, guardar, MIN, MAX };
