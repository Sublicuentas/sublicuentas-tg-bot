/* SUBLICUENTAS · Sorteos y fidelidad
   Registra boletos desde compras/renovaciones sin impedir la operación
   principal si el módulo de premios estuviera temporalmente fuera de línea. */
'use strict';

const { createHash } = require('crypto');
const { admin, db } = require('./index_01_core');

const DEFAULT_RULES=Object.freeze({compra:1,renovacion:2,oro:3,ciclosOro:6,limitePorCliente:30});
const clean=(value,max=300)=>String(value==null?'':value).replace(/[\u0000-\u001F]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const norm=value=>clean(value,160).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
const safeId=value=>clean(value,160).replace(/[^a-zA-Z0-9_-]/g,'');
const hash=(value,length=40)=>createHash('sha256').update(String(value||'')).digest('hex').slice(0,length);
const integer=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.round(Number(value)))):fallback;
const dateKey=value=>{
  const raw=clean(value,40),dmy=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const candidate=dmy?`${dmy[3]}-${dmy[2]}-${dmy[1]}`:raw.slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(candidate))return '';
  const date=new Date(`${candidate}T12:00:00Z`);
  return Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==candidate?'':candidate;
};
const eventIdFor=(raw={},type='')=>{
  const compraId=safeId(raw.compraId);
  if(compraId&&type==='compra')return `compra:${compraId}`;
  const date=dateKey(raw.fechaEvento);
  if(compraId&&type==='renovacion'&&date)return `renov:${compraId}:${date}`;
  return clean(raw.eventoId,500);
};

function rules(raw={}){
  return {
    compra:integer(raw.compra,0,20,DEFAULT_RULES.compra),renovacion:integer(raw.renovacion,0,20,DEFAULT_RULES.renovacion),
    oro:integer(raw.oro,0,20,DEFAULT_RULES.oro),ciclosOro:integer(raw.ciclosOro,1,60,DEFAULT_RULES.ciclosOro),
    limitePorCliente:integer(raw.limitePorCliente,1,200,DEFAULT_RULES.limitePorCliente)
  };
}
function vendorGroup(value){
  const raw=norm(value);
  if(['relojes','reloj','libni'].includes(raw))return 'relojes';
  if(['sublicuentas','sublicuenta','naara'].includes(raw))return 'sublicuentas';
  return raw;
}
function vendorEligible(value){return ['sublicuentas','relojes'].includes(vendorGroup(value));}
function iso(value){const date=new Date(clean(value,40));return Number.isNaN(date.getTime())?'':date.toISOString();}
function monthHonduras(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Tegucigalpa',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  const get=type=>parts.find(part=>part.type===type)?.value||'';return `${get('year')}-${get('month')}`;
}
function activeDraw(draw={},now=Date.now()){
  if(draw.estado!=='activo')return false;
  const start=iso(draw.fechaInicio),end=iso(draw.fechaFin);
  return !(start&&new Date(start).getTime()>now)&&!(end&&new Date(end).getTime()<now);
}
function scopeAllows(scope,vendor){
  const target=norm(scope||'sublicuentas'),group=vendorGroup(vendor);
  return target==='ambos'?['sublicuentas','relojes'].includes(group):target===group;
}
function categoryAllows(category,eventType){
  const target=norm(category||'general');
  if(eventType==='oro')return target==='oro'||target==='general';
  if(target==='general')return ['compra','renovacion'].includes(eventType);
  return target===eventType||(target==='compras'&&eventType==='compra')||(target==='renovaciones'&&eventType==='renovacion');
}

async function updateLoyalty(event){
  const clientId=safeId(event.clientId);if(!clientId)return {ciclos:0,nivel:'regular',oro:false};
  const clientRef=db.collection('clientes').doc(clientId),month=monthHonduras();
  const loyaltyRef=db.collection('fidelidad_eventos').doc(hash(`ciclo|${clientId}|${month}`));
  return db.runTransaction(async transaction=>{
    const [clientSnap,eventSnap]=await Promise.all([transaction.get(clientRef),transaction.get(loyaltyRef)]);
    if(!clientSnap.exists)return {ciclos:0,nivel:'regular',oro:false};
    const client=clientSnap.data()||{};let cycles=Math.max(0,Number(client.fidelidadCiclos)||0);
    if(event.tipo==='renovacion'&&!eventSnap.exists){
      cycles+=1;transaction.set(loyaltyRef,{clientId,mes:month,tipo:'renovacion',eventoId:clean(event.eventoId,300),createdAt:admin.firestore.FieldValue.serverTimestamp()});
    }
    const goldAt=Math.max(1,Number(event.ciclosOro)||DEFAULT_RULES.ciclosOro);
    const gold=client.clienteOro===true||norm(client.nivelCliente)==='oro'||cycles>=goldAt;
    transaction.set(clientRef,{fidelidadCiclos:cycles,nivelCliente:gold?'oro':'regular',fidelidadUpdatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    return {ciclos:cycles,nivel:gold?'oro':'regular',oro:gold};
  });
}

async function currentTicketCount(drawId,clientId){
  const snap=await db.collection('sorteo_boletos').where('clientId','==',clientId).get();
  return snap.docs.reduce((sum,doc)=>sum+(String((doc.data()||{}).sorteoId)===drawId?1:0),0);
}

async function createEventTickets(draw,event,quantity){
  const drawId=safeId(draw.id),clientId=safeId(event.clientId),eventId=clean(event.eventoId,500);
  if(!drawId||!clientId||!eventId||quantity<=0)return {creados:0,duplicado:false};
  const drawRules=rules(draw.reglas||{}),existing=await currentTicketCount(drawId,clientId);
  const key=hash(`${drawId}|${event.tipo}|${clientId}|${eventId}`);
  const eventRef=db.collection('sorteo_eventos').doc(key),drawRef=db.collection('sorteos').doc(drawId);
  const counterRef=db.collection('sorteo_contadores').doc(hash(`${drawId}|${clientId}`));
  return db.runTransaction(async transaction=>{
    const [eventSnap,drawSnap,counterSnap]=await Promise.all([transaction.get(eventRef),transaction.get(drawRef),transaction.get(counterRef)]);
    if(eventSnap.exists)return {creados:0,duplicado:true};
    if(!drawSnap.exists||!activeDraw(drawSnap.data()||{}))return {creados:0,cerrado:true};
    const counted=counterSnap.exists?Math.max(0,Number((counterSnap.data()||{}).total)||0):existing;
    const total=Math.min(Math.max(0,Number(quantity)||0),Math.max(0,drawRules.limitePorCliente-counted));
    if(!total){
      transaction.set(eventRef,{sorteoId:drawId,clientId,tipo:event.tipo,eventoId:eventId,cantidad:0,limitado:true,createdAt:admin.firestore.FieldValue.serverTimestamp()});
      transaction.set(counterRef,{sorteoId:drawId,clientId,total:counted,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
      return {creados:0,limite:true};
    }
    const latest=drawSnap.data()||{},start=Math.max(0,Number(latest.ultimoNumero)||0)+1,codes=[];
    for(let index=0;index<total;index+=1){
      const number=start+index,code=`SOR-${String(drawId).slice(-4).toUpperCase()}-${String(number).padStart(5,'0')}`;
      transaction.set(db.collection('sorteo_boletos').doc(`${drawId}_${String(number).padStart(8,'0')}`),{
        sorteoId:drawId,numero:number,codigo:code,clientId,clienteNombre:clean(event.clienteNombre,120),telefono:clean(event.telefono,40),
        vendedor:clean(event.vendedor,80),vendedorNorm:norm(event.vendedorNorm||event.vendedor),tipo:event.tipo,origen:clean(event.origen||event.tipo,80),
        eventoId:eventId,activo:true,createdAt:admin.firestore.FieldValue.serverTimestamp()
      });codes.push(code);
    }
    transaction.set(eventRef,{sorteoId:drawId,clientId,tipo:event.tipo,eventoId:eventId,cantidad:total,codigos:codes,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    transaction.set(counterRef,{sorteoId:drawId,clientId,total:counted+total,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    transaction.set(drawRef,{ultimoNumero:start+total-1,totalBoletos:admin.firestore.FieldValue.increment(total),updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    return {creados:total,codigos:codes,duplicado:false};
  });
}

async function registrarEventoSorteos(rawEvent={}){
  const type=['compra','renovacion'].includes(norm(rawEvent.tipo))?norm(rawEvent.tipo):'';
  const clientId=safeId(rawEvent.clientId),eventId=eventIdFor(rawEvent,type);
  if(!type||!clientId||!eventId)return {ok:false,omitido:'evento_incompleto',creados:0};
  const clientSnap=await db.collection('clientes').doc(clientId).get();
  if(!clientSnap.exists)return {ok:false,omitido:'cliente_no_existe',creados:0};
  // El vendedor del evento/servicio manda. `cliente.vendedor` es solo un
  // campo legacy y puede representar otra cuenta de un cliente compartido.
  const client=clientSnap.data()||{},vendor=clean(rawEvent.vendedor||client.vendedor,80),vendorNorm=vendorGroup(rawEvent.vendedorNorm||rawEvent.vendedor||client.vendedor_norm||client.vendedor);
  if(!vendorEligible(vendorNorm))return {ok:true,omitido:'vendedor_no_elegible',creados:0};
  const event={tipo:type,clientId,eventoId:eventId,clienteNombre:clean(rawEvent.clienteNombre||client.nombrePerfil||client.nombre||'Cliente',120),
    telefono:clean(rawEvent.telefono||client.telefono,40),vendedor:vendor,vendedorNorm:vendorNorm,origen:clean(rawEvent.origen||'Telegram',80)};
  const loyalty=await updateLoyalty({...event,ciclosOro:rawEvent.ciclosOro});
  const drawSnap=await db.collection('sorteos').where('estado','==','activo').limit(100).get();
  const draws=drawSnap.docs.map(doc=>({id:doc.id,...(doc.data()||{})})).filter(draw=>activeDraw(draw)&&scopeAllows(draw.alcance,vendorNorm));
  const results=[];
  for(const draw of draws){
    const drawRules=rules(draw.reglas||{});
    if(categoryAllows(draw.categoria,type))results.push({sorteoId:draw.id,tipo:type,...await createEventTickets(draw,event,type==='compra'?drawRules.compra:drawRules.renovacion)});
    if(loyalty.oro&&categoryAllows(draw.categoria,'oro'))results.push({sorteoId:draw.id,tipo:'oro',...await createEventTickets(draw,{...event,tipo:'oro',eventoId:`oro:${clientId}:${draw.id}`,origen:'Cliente Oro'},drawRules.oro)});
  }
  return {ok:true,creados:results.reduce((sum,item)=>sum+Number(item.creados||0),0),fidelidad:loyalty,resultados:results};
}

async function registrarEventoSorteosSeguro(event={}){
  try{return await registrarEventoSorteos(event);}
  catch(error){console.error('SORTEOS_EVENT_ERROR',error?.message||error);return {ok:false,creados:0,error:String(error?.message||error||'Error de sorteos')};}
}

module.exports={DEFAULT_RULES,dateKey,eventIdFor,vendorGroup,vendorEligible,registrarEventoSorteos,registrarEventoSorteosSeguro};
