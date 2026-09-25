/* Panel de Socios · perfil, ranking y gamificación compartida */
const { revAuth, revAdminAuth, capacidadesRevendedor } = require("./index_09_api_auth");
const { db, admin, bot, SUPER_ADMIN } = require("./index_01_core");
const { normVendedor, vendedorEfectivoServicio } = require("./index_17_vendedores_servicio");
const RECOMPENSAS = {
  Diamante:[{id:"hbo_1m",nombre:"HBO Max · 1 mes"},{id:"disney_sin_espn_1m",nombre:"Disney sin ESPN · 1 mes"},{id:"canva_1m",nombre:"Canva · 1 mes"}],
  Leyenda:[{id:"prime_1m",nombre:"Prime Video · 1 mes"},{id:"duolingo_1m",nombre:"Duolingo · 1 mes"},{id:"crunchyroll_1m",nombre:"Crunchyroll · 1 mes"}],
  Inmortal:[{id:"descuento_20",nombre:"20% de descuento"},{id:"gemini_1m",nombre:"Gemini Pro · 1 mes"},{id:"netflix_15d",nombre:"Netflix · 15 días"}],
};

function dateMs(v) {
  if (!v) return 0;
  if (v.toMillis) return v.toMillis();
  if (v._seconds || v.seconds) return Number(v._seconds || v.seconds) * 1000;
  const n = new Date(v).getTime(); return Number.isFinite(n) ? n : 0;
}

async function liveCaps(rev = {}) {
  let live = { ...rev };
  try {
    if (rev.id) {
      const snap = await db.collection("revendedores").doc(String(rev.id)).get();
      if (snap.exists) live = { ...live, id:snap.id, ...snap.data() };
    }
  } catch (_) {}
  return capacidadesRevendedor(live);
}

function nivel(ventas) {
  if (ventas < 1) return "Sin nivel";
  if (ventas >= 26) return "Inmortal";
  if (ventas >= 10) return "Leyenda";
  return "Diamante";
}
const AVATAR_STORAGE_BUCKETS=[...new Set([
  process.env.STORAGE_BUCKET,
  process.env.FIREBASE_STORAGE_BUCKET,
  process.env.GCLOUD_STORAGE_BUCKET,
  process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app` : "",
  process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.appspot.com` : "",
].map(v=>String(v||"").trim()).filter(Boolean))];

async function guardarAvatarSocio(docId, avatarData) {
  const raw=String(avatarData||"");
  if(!raw)return "";
  const m=raw.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i);
  if(!m || raw.length>760000)throw Object.assign(new Error("foto_invalida"),{publicError:"foto_invalida"});
  const mime=m[1].toLowerCase(),buffer=Buffer.from(m[2],"base64");
  if(!buffer.length || buffer.length>560000)throw Object.assign(new Error("foto_invalida"),{publicError:"foto_invalida"});
  const ext=mime.includes("png")?"png":mime.includes("webp")?"webp":"jpg";
  const safeId=String(docId||"socio").replace(/[^a-z0-9_-]/gi,"_").slice(0,80)||"socio";
  const path=`socios-avatares/${safeId}_${Date.now()}.${ext}`;
  for(const bucketName of AVATAR_STORAGE_BUCKETS){
    try{
      const file=admin.storage().bucket(bucketName).file(path);
      await file.save(buffer,{resumable:false,contentType:mime,metadata:{cacheControl:"public,max-age=31536000"}});
      const [url]=await file.getSignedUrl({action:"read",expires:"2099-12-31"});
      if(url)return url;
    }catch(e){console.error("avatar storage",bucketName,e?.message||e);}
  }
  // Fallback: si Storage no está habilitado, conservamos la foto comprimida
  // dentro del documento del revendedor. Así el perfil no queda bloqueado.
  return raw;
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
      const ventasPorSocio = {}, clientesIdsPorSocio = {};
      cliSnap.docs.forEach(doc => {
        const c = doc.data() || {};
        (Array.isArray(c.servicios) ? c.servicios : []).forEach(servicio => {
          const k = vendedorEfectivoServicio(servicio, c).vendedor_norm;
          if (!k) return;
          ventasPorSocio[k] = (ventasPorSocio[k] || 0) + 1;
          if (!clientesIdsPorSocio[k]) clientesIdsPorSocio[k] = new Set();
          clientesIdsPorSocio[k].add(doc.id);
        });
      });
      const ranking = revSnap.docs.map(doc => {
        const r = doc.data() || {}, k = String(r.nombre_norm || doc.id).toLowerCase();
        const ventas = ventasPorSocio[k] || 0;
        const ren = renovaciones.filter(x => String(x.socio_norm || "").toLowerCase() === k);
        const cursos = Array.isArray(r.cursosCompletados) ? r.cursosCompletados.length : 0;
        return { id: doc.id, nombre: r.nombre || k, nombreMostrar:r.nombreMostrar || r.nombre || k, nombre_norm:k, avatar:r.avatarData || "", ventas, clientes:clientesIdsPorSocio[k]?.size || 0, renovaciones:ren.length, cursos, cursosCompletados:Array.isArray(r.cursosCompletados)?r.cursosCompletados.map(String).slice(0,100):[], racha:rachaDias(ren), nivel:nivel(ventas), score:ventas*100 + ren.length*25 + cursos*50 };
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
      const claimSnap=await db.collection("recompensas_socios").where("socio_norm","==",String(req.rev.nombre_norm||"").toLowerCase()).get();
      const solicitudes=claimSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>dateMs(b.createdAt)-dateMs(a.createdAt));
      res.json({ ok:true, perfil:me, insignias, catalogoActualizadoAt, recompensas:RECOMPENSAS[me?.nivel]||[], solicitudes });
    } catch (e) { console.error("rev/gamificacion",e); res.status(500).json({error:"server"}); }
  });

  app.post("/rev/perfil", revAuth, async (req,res) => {
    try {
      // Algunos tokens antiguos no traían id; resolvemos el documento por nombre
      // para que la foto/perfil siga guardando sin obligar al socio a cerrar sesión.
      let ref = null;
      const tokenId = String(req.rev?.id || "").trim();
      if (tokenId) ref = db.collection("revendedores").doc(tokenId);
      if (!ref) {
        const wanted = normVendedor(req.rev?.nombre_norm || req.rev?.nombre || "");
        if (!wanted) return res.status(400).json({error:"perfil_no_identificado"});
        const aliases = wanted === "geisell" ? ["geisell","geissel"] : [wanted];
        let found = null;
        for (const alias of aliases) {
          const snap = await db.collection("revendedores").where("nombre_norm","==",alias).limit(1).get();
          if (!snap.empty) { found = snap.docs[0]; break; }
        }
        if (!found) return res.status(404).json({error:"perfil_no_existe"});
        ref = found.ref;
      }

      const body=req.body||{};
      const patch={perfilUpdatedAt:admin.firestore.FieldValue.serverTimestamp()};
      const response={ok:true,updatedAt:new Date().toISOString()};

      if(Object.prototype.hasOwnProperty.call(body,"avatarData")){
        const avatarData=String(body.avatarData||"");
        try{
          const avatarGuardado=avatarData ? await guardarAvatarSocio(ref.id,avatarData) : "";
          patch.avatarData=avatarGuardado;
          response.avatar=avatarGuardado;
        }catch(e){
          if(e?.publicError==="foto_invalida")return res.status(413).json({error:"foto_invalida"});
          throw e;
        }
      }
      if(Object.prototype.hasOwnProperty.call(body,"nombreMostrar")){
        const nombreMostrar=String(body.nombreMostrar||"").trim().replace(/[<>]/g,"").slice(0,45);
        if(nombreMostrar.length<2)return res.status(400).json({error:"nombre_invalido"});
        patch.nombreMostrar=nombreMostrar;
        response.nombreMostrar=nombreMostrar;
      }
      if(Object.keys(patch).length===1)return res.status(400).json({error:"sin_cambios"});

      await ref.set(patch,{merge:true});
      // No devolvemos FieldValue.serverTimestamp(): ese objeto especial no es
      // una respuesta JSON y era la causa de guardados que terminaban en 500.
      return res.json(response);
    } catch(e) {
      console.error("rev/perfil",e);
      return res.status(500).json({error:"server"});
    }
  });

  app.post("/rev/curso-completado", revAuth, async (req,res) => {
    try {
      const caps=await liveCaps(req.rev);
      if(!caps.aula && !caps.canUseAI)return res.status(403).json({error:"sin_permiso_aula"});
      const cursoId=String(req.body?.cursoId||"").replace(/[^a-z0-9_-]/gi,"").slice(0,60);
      if(!cursoId)return res.status(400).json({error:"curso_invalido"});
      await db.collection("revendedores").doc(req.rev.id).set({cursosCompletados:admin.firestore.FieldValue.arrayUnion(cursoId),cursoUpdatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
      res.json({ok:true,cursoId});
    } catch(e){console.error("rev/curso-completado",e);res.status(500).json({error:"server"});}
  });
  app.post("/rev/recompensa", revAuth, async (req,res) => {
    try {
      const caps=await liveCaps(req.rev);
      if(!caps.recompensas)return res.status(403).json({error:"sin_permiso_recompensas"});
      const [revDoc,cliSnap]=await Promise.all([db.collection("revendedores").doc(req.rev.id).get(),db.collection("clientes").get()]);
      const vendedorNorm = normVendedor(req.rev.nombre_norm || req.rev.nombre || "");
      const ventas=cliSnap.docs.reduce((total,d)=>{
        const cliente=d.data()||{};
        return total+(Array.isArray(cliente.servicios)?cliente.servicios:[]).filter(servicio=>vendedorEfectivoServicio(servicio,cliente).vendedor_norm===vendedorNorm).length;
      },0),lvl=nivel(ventas);
      const opciones=RECOMPENSAS[lvl]||[],op=opciones.find(x=>x.id===String(req.body?.recompensaId||""));
      if(!op)return res.status(400).json({error:"recompensa_no_disponible"});
      const anterior=await db.collection("recompensas_socios").where("socio_norm","==",req.rev.nombre_norm).get();
      if(anterior.docs.some(d=>String((d.data()||{}).nivel)===lvl))return res.status(409).json({error:"nivel_ya_reclamado"});
      const doc={socio:req.rev.nombre||req.rev.nombre_norm,socio_norm:req.rev.nombre_norm,nivel:lvl,ventas,recompensaId:op.id,recompensa:op.nombre,estado:"pendiente",createdAt:admin.firestore.FieldValue.serverTimestamp()};
      const ref=await db.collection("recompensas_socios").add(doc);
      if(bot&&SUPER_ADMIN)bot.sendMessage(SUPER_ADMIN,`🎁 RECOMPENSA SOLICITADA\nSocio: ${doc.socio}\nNivel: ${lvl}\nPremio: ${op.nombre}\nVentas: ${ventas}\nRef: ${ref.id.slice(-6)}`).catch(()=>{});
      res.json({ok:true,id:ref.id,...doc});
    }catch(e){console.error("rev/recompensa",e);res.status(500).json({error:"server"});}
  });
  app.get("/rev/admin/recompensas",revAdminAuth,async(req,res)=>{try{const snap=await db.collection("recompensas_socios").get();const items=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>dateMs(b.createdAt)-dateMs(a.createdAt));res.json({ok:true,recompensas:items})}catch(e){res.status(500).json({error:"server"})}});
  app.patch("/rev/admin/recompensas/:id",revAdminAuth,async(req,res)=>{try{const estado=String(req.body?.estado||"");if(!["pendiente","entregada","rechazada"].includes(estado))return res.status(400).json({error:"estado_invalido"});const ref=db.collection("recompensas_socios").doc(req.params.id),snap=await ref.get();if(!snap.exists)return res.status(404).json({error:"no_existe"});await ref.update({estado,updatedAt:admin.firestore.FieldValue.serverTimestamp()});res.json({ok:true,id:ref.id,estado})}catch(e){res.status(500).json({error:"server"})}});
};
