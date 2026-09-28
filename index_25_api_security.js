/* SUBLICUENTAS — FASE 3 · SEGURIDAD API / PANEL ADMIN
   ---------------------------------------------------
   - Sesiones JWT individuales por administrador (ya no API_ADMIN_TOKEN compartido)
   - Permisos granulares reutilizando el ACL de negocio
   - Sesiones revocables en Firestore
   - CORS restringido y cabeceras defensivas
   - Auditoría de mutaciones administrativas sin guardar secretos
*/
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const {
  PROFILE_PERMISSIONS,
  permissionsForProfile,
  permissionGranted,
  anyPermissionGranted,
  normalizeText,
} = require('./lib_hardening');

const ADMIN_SESSIONS_COLLECTION = 'admin_api_sessions';
const ADMIN_LOGIN_ATTEMPTS_COLLECTION = 'admin_api_login_attempts';
const ADMIN_SESSION_TTL_SEC = Math.max(900, Math.min(Number(process.env.ADMIN_SESSION_TTL_SEC || 21600), 86400));
const ADMIN_SESSION_CACHE_MS = 30_000;
const ISSUER = 'sublicuentas';
const AUDIENCE = 'sublicuentas-admin';
const TOKEN_TYPE = 'admin-session-v3';
const _sessionCache = new Map();
const _ipHits = new Map();

function getApiJwtSecret() {
  const s = String(process.env.JWT_SECRET || '').trim();
  if (!s || s === 'CAMBIAME_EN_RENDER') throw new Error('[FATAL] JWT_SECRET no configurado para sesiones admin.');
  return s;
}

function compact(v='') {
  return normalizeText(v).replace(/[^a-z0-9_.-]+/g, '');
}

function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const bh = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function profileLabel(profile='') {
  const p = compact(profile);
  if (p === 'sublicuentas') return 'Sublicuentas';
  if (p === 'relojes') return 'Relojes';
  if (p === 'geisell' || p === 'geissel') return 'Geisell';
  if (p === 'magdiel') return 'Magdiel';
  return p || 'Admin';
}

function parsePermissions(value) {
  if (Array.isArray(value)) return value.map(x=>String(x||'').trim()).filter(Boolean);
  if (value && typeof value === 'object') return Object.entries(value).filter(([,enabled])=>enabled===true).map(([k])=>String(k));
  return [];
}

function accountPermissions(account={}) {
  const base = permissionsForProfile(account.profile || 'admin');
  for (const p of parsePermissions(account.permissions)) base.add(p);
  for (const p of parsePermissions(account.denyPermissions)) base.delete(p);
  return [...base];
}

function envAccount(profile, userKey, passwordKey, extra={}) {
  const username = String(process.env[userKey] || '').trim().toLowerCase();
  const password = String(process.env[passwordKey] || '');
  if (!username || !password) return null;
  return { id:`env:${profile}`, username, password, profile, active:true, ...extra };
}

function loadAdminAccounts() {
  const out = [];
  const fixed = [
    envAccount('sublicuentas', 'ADMIN_USER', 'ADMIN_PASSWORD'),
    envAccount('relojes', 'RELOJES_ADMIN_USER', 'RELOJES_ADMIN_PASSWORD'),
    envAccount('geisell', 'GEISELL_ADMIN_USER', 'GEISELL_ADMIN_PASSWORD'),
    envAccount('magdiel', 'MAGDIEL_ADMIN_USER', 'MAGDIEL_ADMIN_PASSWORD'),
  ].filter(Boolean);
  out.push(...fixed);

  const raw = String(process.env.ADMIN_ACCOUNTS_JSON || '').trim();
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const x of arr) {
          if (!x || typeof x !== 'object' || x.active === false) continue;
          const username = String(x.username || x.usuario || '').trim().toLowerCase();
          const profile = compact(x.profile || x.perfil || 'admin');
          if (!username || !Object.prototype.hasOwnProperty.call(PROFILE_PERMISSIONS, profile)) continue;
          if (!x.password && !x.passwordHash) continue;
          out.push({
            id:String(x.id || `json:${username}`).slice(0,120), username, profile,
            password:String(x.password || ''), passwordHash:String(x.passwordHash || ''),
            permissions:parsePermissions(x.permissions), denyPermissions:parsePermissions(x.denyPermissions), active:true,
          });
        }
      }
    } catch (e) {
      console.error('ADMIN_ACCOUNTS_JSON inválido:', e.message);
    }
  }

  const dedup = new Map();
  for (const a of out) if (!dedup.has(a.username)) dedup.set(a.username, a);
  return [...dedup.values()];
}

function findAdminAccount(username='') {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  return loadAdminAccounts().find(a=>a.username===u) || null;
}

async function verifyAdminPassword(account, password='') {
  if (!account || account.active === false) return false;
  if (account.passwordHash) {
    try { return await bcrypt.compare(String(password || ''), account.passwordHash); } catch (_) { return false; }
  }
  return safeEqual(String(password || ''), String(account.password || ''));
}

function requestIp(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0,120);
}

function adminLoginIpLimiter(req, res, next) {
  const ip = requestIp(req), now = Date.now();
  const old = _ipHits.get(ip);
  const s = (!old || now-old.start >= 60_000) ? {start:now,count:0} : old;
  s.count++; _ipHits.set(ip,s);
  if (_ipHits.size > 2000) for (const [k,v] of _ipHits) if (now-v.start > 120_000) _ipHits.delete(k);
  if (s.count > 15) return res.status(429).json({ok:false,error:'demasiados_intentos'});
  next();
}

function loginAttemptKey(username='') {
  return 'admin_' + crypto.createHash('sha256').update(String(username||'').trim().toLowerCase()).digest('hex').slice(0,32);
}

async function checkPersistentLoginThrottle(db, username='') {
  try {
    const snap = await db.collection(ADMIN_LOGIN_ATTEMPTS_COLLECTION).doc(loginAttemptKey(username)).get();
    if (!snap.exists) return {blocked:false};
    const d=snap.data()||{}, now=Date.now(), until=Number(d.blockedUntil||0);
    if (until>now) return {blocked:true,retryAfterSeconds:Math.ceil((until-now)/1000)};
  } catch (_) {}
  return {blocked:false};
}

async function recordAdminLoginFailure(db, username='') {
  try {
    const ref=db.collection(ADMIN_LOGIN_ATTEMPTS_COLLECTION).doc(loginAttemptKey(username));
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref), now=Date.now(), d=snap.exists?(snap.data()||{}):{};
      const stale=!d.firstAt || now-Number(d.firstAt)>15*60_000;
      const failures=stale?1:Number(d.failures||0)+1;
      const patch={failures,firstAt:stale?now:Number(d.firstAt),updatedAt:now};
      if(failures>=8) patch.blockedUntil=now+15*60_000;
      tx.set(ref,patch,{merge:true});
    });
  } catch (_) {}
}

async function clearAdminLoginFailures(db, username='') {
  try { await db.collection(ADMIN_LOGIN_ATTEMPTS_COLLECTION).doc(loginAttemptKey(username)).delete(); } catch (_) {}
}

function requestFingerprint(req) {
  return crypto.createHash('sha256').update(`${requestIp(req)}|${String(req.headers?.['user-agent']||'').slice(0,300)}`).digest('hex').slice(0,32);
}

async function createAdminSession({db, account, req}) {
  const now=Date.now(), sessionId=crypto.randomUUID(), permissions=accountPermissions(account);
  const expiresAtMs=now+ADMIN_SESSION_TTL_SEC*1000;
  const payload={
    admin:true, typ:TOKEN_TYPE, sessionId, sub:String(account.id||account.username),
    username:account.username, profile:compact(account.profile), nombre:profileLabel(account.profile), permissions,
  };
  const token=jwt.sign(payload,getApiJwtSecret(),{expiresIn:ADMIN_SESSION_TTL_SEC,issuer:ISSUER,audience:AUDIENCE,jwtid:sessionId});
  await db.collection(ADMIN_SESSIONS_COLLECTION).doc(sessionId).set({
    username:account.username, profile:compact(account.profile), nombre:profileLabel(account.profile), permissions,
    active:true, revoked:false, createdAtMs:now, expiresAtMs, createdAt:new Date(now), expiresAt:new Date(expiresAtMs), fingerprint:requestFingerprint(req),
  });
  _sessionCache.set(sessionId,{at:now,value:{active:true,revoked:false,expiresAtMs,username:account.username,profile:compact(account.profile),permissions}});
  return {token, admin:true, usuario:account.username, username:account.username, profile:compact(account.profile), nombre:profileLabel(account.profile), permissions, expiresIn:ADMIN_SESSION_TTL_SEC};
}

function createAdminLoginHandler({db}) {
  return async (req,res)=>{
    const username=String(req.body?.usuario||req.body?.username||'').trim().toLowerCase();
    const password=String(req.body?.password||'');
    if(!username||!password) return res.status(400).json({ok:false,error:'faltan_datos'});
    const throttle=await checkPersistentLoginThrottle(db,username);
    if(throttle.blocked) return res.status(429).json({ok:false,error:'demasiados_intentos',retryAfterSeconds:throttle.retryAfterSeconds});
    const account=findAdminAccount(username);
    if(!account || !(await verifyAdminPassword(account,password))){
      await recordAdminLoginFailure(db,username);
      return res.status(400).json({ok:false,error:'credenciales'});
    }
    await clearAdminLoginFailures(db,username);
    try { return res.json({ok:true,...(await createAdminSession({db,account,req}))}); }
    catch(e){ console.error('admin login session',e); return res.status(500).json({ok:false,error:'session_error'}); }
  };
}

async function getSession(db, sessionId='') {
  const now=Date.now(), cached=_sessionCache.get(sessionId);
  if(cached && now-cached.at<ADMIN_SESSION_CACHE_MS) return cached.value;
  const snap=await db.collection(ADMIN_SESSIONS_COLLECTION).doc(sessionId).get();
  const value=snap.exists?(snap.data()||{}):null;
  _sessionCache.set(sessionId,{at:now,value});
  return value;
}

function createAdminSessionAuth({db}) {
  return async function adminSessionAuth(req,res,next){
    const h=String(req.headers.authorization||''), token=h.startsWith('Bearer ')?h.slice(7).trim():'';
    if(!token) return res.status(401).json({ok:false,error:'sin_token'});
    try{
      const p=jwt.verify(token,getApiJwtSecret(),{issuer:ISSUER,audience:AUDIENCE});
      if(!p?.admin || p.typ!==TOKEN_TYPE || !p.sessionId || String(p.jti||'')!==String(p.sessionId)) return res.status(401).json({ok:false,error:'sesion_antigua'});
      const session=await getSession(db,String(p.sessionId));
      if(!session || session.revoked===true || session.active===false || Number(session.expiresAtMs||0)<=Date.now()) return res.status(401).json({ok:false,error:'sesion_revocada'});
      if(String(session.username||'')!==String(p.username||'') || compact(session.profile)!==compact(p.profile)) return res.status(401).json({ok:false,error:'sesion_invalida'});
      req.admin={...p,permissions:Array.isArray(session.permissions)?session.permissions:(p.permissions||[]),nombre:session.nombre||p.nombre||profileLabel(p.profile)};
      next();
    }catch(e){ return res.status(401).json({ok:false,error:e?.name==='TokenExpiredError'?'sesion_expirada':'token_invalido'}); }
  };
}

function adminPermission(permission) {
  return (req,res,next)=>{
    const set=new Set(req.admin?.permissions||[]);
    if(permissionGranted(set,permission)) return next();
    return res.status(403).json({ok:false,error:'sin_permiso',permiso:permission});
  };
}
function adminAnyPermission(permissions=[]) {
  return (req,res,next)=>{
    const set=new Set(req.admin?.permissions||[]);
    if(anyPermissionGranted(set,permissions)) return next();
    return res.status(403).json({ok:false,error:'sin_permiso'});
  };
}

function createAdminLogoutHandler({db}) {
  return async (req,res)=>{
    const id=String(req.admin?.sessionId||'');
    if(id){
      _sessionCache.delete(id);
      await db.collection(ADMIN_SESSIONS_COLLECTION).doc(id).set({active:false,revoked:true,revokedAtMs:Date.now()},{merge:true}).catch(()=>{});
    }
    res.json({ok:true});
  };
}

function createAdminMeHandler() {
  return (req,res)=>res.json({ok:true,admin:true,usuario:req.admin?.username||'',nombre:req.admin?.nombre||'',profile:req.admin?.profile||'',permissions:req.admin?.permissions||[]});
}

function splitOrigins(raw='') { return String(raw||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean); }
function originAllowed(origin, patterns) {
  if(!origin) return true; // Android nativo, curl y server-to-server
  let url; try{url=new URL(origin);}catch(_){return false;}
  const exact=new Set(patterns.filter(x=>!x.includes('*')));
  if(exact.has(origin)) return true;
  for(const p of patterns.filter(x=>x.includes('*'))){
    const m=p.match(/^(https?:\/\/)\*\.(.+)$/i);
    if(m && `${url.protocol}//`.toLowerCase()===m[1].toLowerCase() && (url.hostname===m[2] || url.hostname.endsWith('.'+m[2]))) return true;
  }
  return false;
}
function corsPatterns() {
  const configured=[
    ...splitOrigins(process.env.CORS_ALLOWED_ORIGINS), ...splitOrigins(process.env.PANEL_ALLOWED_ORIGINS),
    ...splitOrigins(process.env.APP_ALLOWED_ORIGINS), ...splitOrigins(process.env.PANEL_WEB_URL),
    ...splitOrigins(process.env.SUBLICHAT_WEB_URL), ...splitOrigins(process.env.VERCEL_FRONTEND_URL),
  ];
  const defaults=[
    'https://sublicuentas.com','https://www.sublicuentas.com','https://*.sublicuentas.com',
    'https://*.capuchino.lat','https://*.imitatiko.lat',
    // Orígenes locales habituales de APK híbrida/WebView. No abren acceso a sitios web remotos.
    'capacitor://localhost','ionic://localhost','http://localhost','https://localhost',
  ];
  if(String(process.env.NODE_ENV||'').toLowerCase()!=='production') defaults.push('http://localhost:3000','http://localhost:5173','http://127.0.0.1:5173');
  return [...new Set([...configured,...defaults])];
}
function buildCorsOptions() {
  const patterns=corsPatterns();
  return {
    origin(origin,cb){ cb(null,originAllowed(origin,patterns)); },
    methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders:['Authorization','Content-Type','X-Requested-With','X-Request-Id'],
    exposedHeaders:['X-Request-Id','X-Catalogo-Tarifa','X-Catalogo-Origen'],
    credentials:false,maxAge:600,
  };
}

function apiSecurityHeaders(req,res,next) {
  res.set('X-Content-Type-Options','nosniff');
  res.set('X-Frame-Options','DENY');
  res.set('Referrer-Policy','no-referrer');
  res.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(/^\/(?:api|rev\/admin)(?:\/|$)/.test(req.path||req.originalUrl||'')) res.set('Cache-Control','no-store');
  const requestId=String(req.headers['x-request-id']||crypto.randomUUID()).slice(0,80);
  req.requestId=requestId; res.set('X-Request-Id',requestId);
  next();
}

function createAdminAuditMiddleware({db, source='API'}) {
  return (req,res,next)=>{
    if(!['POST','PUT','PATCH','DELETE'].includes(String(req.method||'').toUpperCase())) return next();
    const started=Date.now();
    res.on('finish',()=>{
      const actor=req.admin||{};
      if(!actor.username) return;
      const route=String(req.route?.path||req.path||req.originalUrl||'').split('?')[0].slice(0,220);
      db.collection('actividad_usuarios').add({
        usuario:compact(actor.username)||compact(actor.profile)||'admin', actorLabel:actor.nombre||profileLabel(actor.profile), rol:'admin_api',
        uid:String(actor.sessionId||''), modulo:'API / Panel Admin', accion:`${String(req.method||'').toUpperCase()} ${route}`.slice(0,180),
        metodo:String(req.method||''), ruta:route, origen:source, requestId:String(req.requestId||''), statusCode:Number(res.statusCode||0),
        detalle:{profile:compact(actor.profile),resourceId:String(req.params?.id||'').slice(0,160),durationMs:Date.now()-started},
        detalleTexto:`${String(req.method||'').toUpperCase()} ${route} · ${res.statusCode}`.slice(0,520), createdAt:new Date(), updatedAt:new Date(),
      }).catch(()=>{});
    });
    next();
  };
}

function adminScopeProfile(req){ return compact(req.admin?.profile||''); }
function isFullAdmin(req){ return permissionGranted(new Set(req.admin?.permissions||[]),'*'); }

module.exports={
  getApiJwtSecret, loadAdminAccounts, findAdminAccount, verifyAdminPassword, accountPermissions,
  adminLoginIpLimiter, createAdminLoginHandler, createAdminSession, createAdminSessionAuth,
  adminPermission, adminAnyPermission, createAdminLogoutHandler, createAdminMeHandler,
  buildCorsOptions, apiSecurityHeaders, createAdminAuditMiddleware, adminScopeProfile, isFullAdmin,
  TOKEN_TYPE, ADMIN_SESSION_TTL_SEC,
};
