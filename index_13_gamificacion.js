/* Panel de Socios · perfil, ranking y gamificación compartida */
const { revAuth } = require("./index_09_api_auth");
const { db, admin } = require("./index_01_core");

function dateMs(v) {
  if (!v) return 0;
  if (v.toMillis) return v.toMillis();
  if (v._seconds || v.seconds) return Number(v._seconds || v.seconds) * 1000;
  const n = new Date(v).getTime(); return Number.isFinite(n) ? n : 0;
}
function nivel(ventas) {
  if (ventas < 1) return "Sin nivel";
  if (ventas >= 26) return "Inmortal";
  if (ventas >= 10) return "Leyenda";
  return "Diamante";
}
function rachaDias(rows) {
  const days = new Set(rows.map(x => {
    const ms = dateMs(x.createdAt); if (!ms) return "";
    const d = new Date(ms); return `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`;
  }).filter(Boolean));
  let streak = 0, d = new Date(); d.setUTCHours(0,0,0,0);
  while (days.has(`${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`)) { streak++; d.setUTCDate(d.getUTCDate()-1); }
  return streak;
}

module.exports = function mountGamificacion(app) {
  app.get("/rev/gamificacion", revAuth, async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const [revSnap, cliSnap, renSnap, preciosSnap] = await Promise.all([
        db.collection("revendedores").get(), db.collection("clientes").get(),
        db.collection("renovaciones").get(), db.collection("precios").get(),
      ]);
      const renovaciones = renSnap.docs.map(d => d.data() || {});
      const ventasPorSocio = {}, clientesPorSocio = {};
      cliSnap.docs.forEach(doc => {
        const c = doc.data() || {}, k = String(c.vendedor_norm || "").toLowerCase();
        if (!k) return; clientesPorSocio[k] = (clientesPorSocio[k] || 0) + 1;
        ventasPorSocio[k] = (ventasPorSocio[k] || 0) + (Array.isArray(c.servicios) ? c.servicios.length : 0);
      });
      const ranking = revSnap.docs.map(doc => {
        const r = doc.data() || {}, k = String(r.nombre_norm || doc.id).toLowerCase();
        const ventas = ventasPorSocio[k] || 0;
        const ren = renovaciones.filter(x => String(x.socio_norm || "").toLowerCase() === k);
        const cursos = Array.isArray(r.cursosCompletados) ? r.cursosCompletados.length : 0;
        return { id: doc.id, nombre: r.nombre || k, nombre_norm:k, avatar:r.avatarData || "", ventas, clientes:clientesPorSocio[k] || 0, renovaciones:ren.length, cursos, racha:rachaDias(ren), nivel:nivel(ventas), score:ventas*100 + ren.length*25 + cursos*50 };
      }).sort((a,b) => b.ventas-a.ventas || b.score-a.score || a.nombre.localeCompare(b.nombre));
      ranking.forEach((x,i) => x.posicion=i+1);
      const me = ranking.find(x => x.nombre_norm === String(req.rev.nombre_norm || "").toLowerCase()) || null;
      let catalogoActualizadoAt = 0;
      preciosSnap.docs.forEach(d => { catalogoActualizadoAt = Math.max(catalogoActualizadoAt, dateMs((d.data() || {}).updatedAt)); });
      const insignias = me ? [
        { id:"ventas", icon:"💎", nombre:"Primeras ventas", activa:me.ventas>=1, detalle:"Registró su primera venta" },
        { id:"atencion", icon:"🤝", nombre:"Buena atención", activa:me.renovaciones>=5, detalle:"Completó 5 renovaciones" },
        { id:"racha", icon:"🔥", nombre:"Racha activa", activa:me.racha>=3, detalle:"Renovó durante 3 días seguidos" },
        { id:"cursos", icon:"🎓", nombre:"Socio preparado", activa:me.cursos>=1, detalle:"Completó un curso" },
        { id:"inmortal", icon:"👑", nombre:"Inmortal", activa:me.ventas>=26, detalle:"Alcanzó 26 ventas" },
      ] : [];
      res.json({ ok:true, perfil:me, ranking:ranking.slice(0,50), insignias, catalogoActualizadoAt });
    } catch (e) { console.error("rev/gamificacion",e); res.status(500).json({error:"server"}); }
  });

  app.post("/rev/perfil", revAuth, async (req,res) => {
    try {
      const ref = db.collection("revendedores").doc(req.rev.id);
      const avatarData = String(req.body?.avatarData || "");
      if (avatarData && (!/^data:image\/(jpeg|png|webp);base64,/.test(avatarData) || avatarData.length > 700000)) return res.status(413).json({error:"foto_invalida"});
      await ref.set({ avatarData, perfilUpdatedAt:admin.firestore.FieldValue.serverTimestamp() }, {merge:true});
      res.json({ok:true,avatarData});
    } catch(e) { console.error("rev/perfil",e); res.status(500).json({error:"server"}); }
  });
  app.post("/rev/curso-completado", revAuth, async (req,res) => {
    try {
      const cursoId=String(req.body?.cursoId||"").replace(/[^a-z0-9_-]/gi,"").slice(0,60);
      if(!cursoId)return res.status(400).json({error:"curso_invalido"});
      await db.collection("revendedores").doc(req.rev.id).set({cursosCompletados:admin.firestore.FieldValue.arrayUnion(cursoId),cursoUpdatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
      res.json({ok:true,cursoId});
    } catch(e){console.error("rev/curso-completado",e);res.status(500).json({error:"server"});}
  });
};
