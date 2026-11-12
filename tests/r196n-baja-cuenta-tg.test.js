// R196n · Fase 3: la baja desde Telegram ya escribe en el registro COMPARTIDO (Papelera de Integridad, por ID interno),
// con quién la hizo y una clave idempotente. Control Maestro (web) lee ese mismo registro. Aquí se fija que no cambie.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
test("las 2 bajas de cuenta del bot usan trashDocument(kind inventario_cuenta) con actor y clave idempotente", () => {
  const s = fs.readFileSync(path.join(__dirname, "..", "index_06_handlers.js"), "utf8");
  for (const marca of ['data.startsWith("inv:menu:borrarok:")', 'data.startsWith("mail_delete_confirm|")']) {
    const i = s.indexOf(marca), blk = s.slice(i, i + 2500);
    assert.ok(i > 0, marca);
    assert.match(blk, /integrity\.trashDocument\(\{\s*ref(: found\.ref)?, kind: "inventario_cuenta"/);
    assert.match(blk, /actor: \{ userId: String\(userId \|\| ""\)/);
    assert.match(blk, /operationId: integrity\.makeWindowOperationKey\(/);
  }
  const g = fs.readFileSync(path.join(__dirname, "..", "index_26_integrity_guard.js"), "utf8");
  assert.match(g, /const TRASH_COLLECTION = 'papelera_operaciones'/);
  assert.match(g, /source: \{ collection: ref\.parent\.id, id: ref\.id, path: ref\.path \}/);
  assert.match(g, /if \(oldTrash\.exists\) \{/, "repetir la misma baja no borra ni duplica");
});
