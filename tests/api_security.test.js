const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'fase3-test-secret-abcdefghijklmnopqrstuvwxyz-1234567890';
process.env.ADMIN_USER = 'sublicuentas_test';
process.env.ADMIN_PASSWORD = 'clave-admin-test';
process.env.RELOJES_ADMIN_USER = 'relojes_test';
process.env.RELOJES_ADMIN_PASSWORD = 'clave-relojes-test';
process.env.NODE_ENV = 'test';

const {
  findAdminAccount, verifyAdminPassword, accountPermissions, createAdminSession,
  createAdminSessionAuth, adminPermission, buildCorsOptions, TOKEN_TYPE,
} = require('../index_25_api_security');

function fakeDb() {
  const cols = new Map();
  const col = (name) => {
    if (!cols.has(name)) cols.set(name, new Map());
    const docs = cols.get(name);
    return {
      doc(id) {
        return {
          async set(value, opts={}) { docs.set(id, opts.merge ? {...(docs.get(id)||{}),...value} : {...value}); },
          async get() { const d=docs.get(id); return {exists:!!d,data:()=>d}; },
          async delete() { docs.delete(id); },
        };
      },
    };
  };
  return { collection: col, _cols: cols };
}

function responseRecorder() {
  return {
    statusCode: 200, body:null,
    status(code){ this.statusCode=code; return this; },
    json(body){ this.body=body; return this; },
  };
}

test('cuentas admin son individuales y heredan ACL del perfil', async () => {
  const sub = findAdminAccount('sublicuentas_test');
  const relojes = findAdminAccount('relojes_test');
  assert.equal(sub.profile, 'sublicuentas');
  assert.equal(relojes.profile, 'relojes');
  assert.equal(await verifyAdminPassword(relojes, 'clave-relojes-test'), true);
  assert.equal(await verifyAdminPassword(relojes, 'incorrecta'), false);
  assert.ok(accountPermissions(sub).includes('*'));
  assert.ok(accountPermissions(relojes).includes('codigos.read'));
  assert.ok(accountPermissions(relojes).includes('socios.compras.own.read'));
  assert.equal(accountPermissions(relojes).includes('finanzas.read'), false);
});

test('sesión admin v3 queda respaldada y autentica por sessionId', async () => {
  const db=fakeDb(), account=findAdminAccount('sublicuentas_test');
  const reqLogin={headers:{'user-agent':'test'},socket:{remoteAddress:'127.0.0.1'}};
  const session=await createAdminSession({db,account,req:reqLogin});
  const decoded=jwt.decode(session.token);
  assert.equal(decoded.typ,TOKEN_TYPE);
  assert.equal(decoded.profile,'sublicuentas');
  assert.ok(decoded.sessionId);

  const req={headers:{authorization:`Bearer ${session.token}`}};
  const res=responseRecorder();
  let passed=false;
  await createAdminSessionAuth({db})(req,res,()=>{passed=true;});
  assert.equal(passed,true);
  assert.equal(req.admin.username,'sublicuentas_test');
});

test('token admin legacy sin sesión v3 es rechazado', async () => {
  const db=fakeDb();
  const legacy=jwt.sign({admin:true,nombre:'Admin'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const req={headers:{authorization:`Bearer ${legacy}`}}, res=responseRecorder();
  let passed=false;
  await createAdminSessionAuth({db})(req,res,()=>{passed=true;});
  assert.equal(passed,false);
  assert.equal(res.statusCode,401);
});

test('ACL HTTP bloquea finanzas a Relojes pero permite su permiso de clientes', () => {
  const relojes=findAdminAccount('relojes_test');
  const req={admin:{permissions:accountPermissions(relojes)}};
  let okClientes=false;
  const res1=responseRecorder();
  adminPermission('clientes.read')(req,res1,()=>{okClientes=true;});
  assert.equal(okClientes,true);

  let okFin=false;
  const res2=responseRecorder();
  adminPermission('finanzas.read')(req,res2,()=>{okFin=true;});
  assert.equal(okFin,false);
  assert.equal(res2.statusCode,403);
});

test('CORS permite dominios Sublicuentas y bloquea origen extraño', async () => {
  const opts=buildCorsOptions();
  const check=(origin)=>new Promise((resolve,reject)=>opts.origin(origin,(err,allowed)=>err?reject(err):resolve(allowed)));
  assert.equal(await check('https://panel.sublicuentas.com'),true);
  assert.equal(await check(undefined),true);
  assert.equal(await check('https://sitio-ajeno.example'),false);
});
