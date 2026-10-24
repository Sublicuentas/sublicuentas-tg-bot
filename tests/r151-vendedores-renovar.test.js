// R151 · Oct-2026 · Bot: registro único de vendedores + renovar con las mismas opciones que Web y APK.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const V = require("../lib_vendedores");
const leer = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("registro: el número guardado manda sobre la lista fija y los números viejos muestran el nuevo", () => {
  const reg = V.armarRegistro(
    [{ id: "relojes", data: { clave: "relojes", nombre: "Relojes", telefono: "99991111", telefonosAnteriores: ["32126332"] } }],
    [{ id: "relojes", data: { nombre: "Relojes", nombre_norm: "relojes", telefono: "32126332" } }],
  );
  assert.equal(reg.telefonos.relojes, "99991111");
  assert.equal(V.telefonoVigente(reg, "Relojes", "32126332"), "99991111");
  assert.equal(V.telefonoVigente(reg, "Relojes", "88001234"), "88001234", "soporte escrito a mano se respeta");
});

test("bot: el resolvedor de vendedores y el menú usan el registro; vreg: requiere equipo.manage", () => {
  const h = leer("index_06_handlers.js");
  assert.match(h, /const vendedoresReg = require\("\.\/lib_vendedores"\)/);
  assert.match(h, /vendedoresReg\.buscar\(reg, entrada\)/);
  assert.match(h, /p\.mode === "revAddTelefono"/);
  assert.match(h, /data\.startsWith\("vreg:e:"\)/);
  assert.equal(require("../lib_hardening").callbackPermission("vreg:d:3"), "equipo.manage");
  const p = leer("index_12_admin_panel.js");
  assert.equal((p.match(/anotarCambioSocio\(/g) || []).length, 3, "crear, editar y eliminar socio desde la Web");
});

test("renovar: +31 días, 1, 2, 3, 6 y 12 meses + Personalizado (igual que Web y APK)", () => {
  const c = leer("index_03_clientes_crm.js");
  const m = c.match(/const DURACIONES_RENOVACION = Object\.freeze\((\[.*?\])\);/);
  assert.ok(m);
  assert.deepEqual(JSON.parse(m[1]).map((x) => x[1]), ["+31 días", "+1 mes", "+2 meses", "+3 meses", "+6 meses", "+12 meses"]);
  assert.match(c, /\{ text: "📅 Personalizado", callback_data: `cli:ren:manual:/);
  // Regla: vigente → desde el vencimiento; vencido → desde hoy. Meses calendario.
  const src = c.slice(c.indexOf("function sumarDuracionRenovacionLocal"), c.indexOf("function mesesEntreDMYLocal"));
  const hoy = "15/10/2026";
  const parse = (d) => { const [dd, mm, yy] = d.split("/").map(Number); return new Date(yy, mm - 1, dd, 12); };
  const fn = new Function("hoyDMY", "isFechaDMY", "parseDMYtoTS", "parseDMYtoDate", "addDaysDMY", `${src}; return sumarDuracionRenovacionLocal;`)(
    () => hoy, (d) => /^\d{2}\/\d{2}\/\d{4}$/.test(d || ""), (d) => parse(d).getTime(), (d) => parse(d),
    (b, n) => { const x = parse(b); x.setDate(x.getDate() + n); return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`; });
  assert.equal(fn("20/10/2026", { dias: 31 }), "20/11/2026", "vigente: desde el vencimiento");
  assert.equal(fn("01/10/2026", { dias: 31 }), "15/11/2026", "vencido: desde hoy");
  assert.equal(fn("31/10/2026", { meses: 1 }), "30/11/2026", "mes calendario");
  assert.equal(fn("20/10/2026", { meses: 12 }), "20/10/2027");
});

test("moneda: L pegado al número", () => {
  assert.match(leer("index_02_utils_roles.js"), /return `L\$\{moneyNumber\(v\)\.toFixed\(2\)\}`/);
  assert.doesNotMatch(leer("index_03_clientes_crm.js"), /\} Lps|Lps\. \$\{/);
});

test("Fase 2 · push: cambio de correo/clave en Bodega avisa al equipo sin datos de la cuenta", async () => {
  const P = require("../lib_push");
  assert.throws(() => P.textoSeguro("correo nuevo a@b.com", 180), /no puede llevar/);
  const inv = leer("lib_inventario_canonico.js");
  assert.match(inv, /require\("\.\/lib_push"\)\.avisar\(db, admin, \{ todos: true/);
  assert.doesNotMatch(inv.slice(inv.indexOf("Fase 2 · aviso push")), /nuevaClave\}|nuevoCorreo\}/, "el aviso no incluye la clave ni el correo");
});
