// Teste local do painel (D1 simulado). Uso: node painel-api/test.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { handle, normTel } from "./worker.js";

const db = new DatabaseSync(":memory:");
db.exec(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const DB = { prepare(sql) { let a = []; const st = db.prepare(sql); return { bind(...x) { a = x; return this; }, async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) ?? null; }, async run() { const r = st.run(...a); return { meta: { changes: r.changes } }; } }; } };
const env = { DB, ADMIN_KEY: "senha-forte-123" };
const O = "https://moshikgueta.github.io";
const req = (m, p, body, { key, origin = O, ip = "1.1.1.1" } = {}) => handle(new Request("https://w.test" + p, {
  method: m, headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": ip, ...(key ? { Authorization: "Bearer " + key } : {}) },
  body: body ? JSON.stringify(body) : undefined }), env);
const K = { key: env.ADMIN_KEY };
const ok = (c, m) => { console.log((c ? "ok   " : "FALHA") + " " + m); if (!c) process.exitCode = 1; };
let n = 0; const pid = () => `B1411-2000-${String(++n).padStart(4, "0")}`;
const ped = (o = {}) => ({ id: pid(), nome: "Ana", tel: "(41) 99991-9434", fid: true, itens: [{ id: "margherita", qtd: 2 }], total: 1, retirada: "19:30", pagamento: "Pix", ...o });

ok(normTel("+55 (41) 99991-9434") === "41999919434" && normTel("123") === "", "normaliza celular");
let p1 = ped(); let r = await req("POST", "/pedido", p1); ok(r.status === 200, "site registra pedido");
r = await req("POST", "/pedido", ped(), { origin: "https://outro.com" }); ok(r.status === 403, "outro site não registra pedido");
r = await req("POST", "/pedido", ped({ tel: "123" })); ok(r.status === 400, "selo sem celular válido é recusado");
r = await req("GET", "/admin/pedidos"); ok(r.status === 401, "painel sem senha é bloqueado");
r = await req("GET", "/admin/pedidos", null, { key: "errada-123" }); ok(r.status === 401, "senha errada é bloqueada");
let j = await (await req("GET", "/admin/pedidos", null, K)).json();
ok(j.pedidos.length === 1 && j.pedidos[0].total === 9580 && j.pedidos[0].status === "novo" && j.pedidos[0].ip === undefined, "painel lista pedido com total do servidor");
await req("POST", "/admin/pedido/status", { id: p1.id, status: "preparo" }, K);
j = await (await req("GET", "/admin/cliente?tel=41999919434", null, K)).json(); ok(j.selos === 0, "em preparo ainda não dá selo");
j = await (await req("POST", "/admin/pedido/status", { id: p1.id, status: "retirado" }, K)).json(); ok(j.selo === "+1" && j.selos === 1, "retirado dá 1 selo");
j = await (await req("POST", "/admin/pedido/status", { id: p1.id, status: "retirado" }, K)).json(); ok(j.selos === 1, "marcar retirado de novo não duplica o selo");
j = await (await req("POST", "/admin/pedido/status", { id: p1.id, status: "pronto" }, K)).json(); ok(j.selo === "removido" && j.selos === 0, "desfazer a retirada tira o selo");
await req("POST", "/admin/pedido/status", { id: p1.id, status: "retirado" }, K);
for (let i = 0; i < 9; i++) await req("POST", "/admin/selo", { tel: "41 99991-9434", delta: 1 }, K);
j = await (await req("GET", "/admin/cliente?tel=41999919434", null, K)).json(); ok(j.selos === 10 && j.podeResgatar && j.nome === "Ana", "10 selos: cartão cheio");
r = await req("GET", "/selos?tel=41999919434"); ok(r.status === 404, "não há consulta pública de selos");
j = await (await req("POST", "/admin/resgate", { tel: "41999919434" }, K)).json(); ok(j.selos === 0, "resgate zera o cartão");
r = await req("POST", "/admin/resgate", { tel: "41999919434" }, K); ok(r.status === 400, "não resgata cartão vazio");
r = await req("POST", "/admin/selo", { tel: "41999919434", delta: -1 }, K); ok(r.status === 400, "não fica negativo");
p1 = ped({ fid: false, tel: "" }); await req("POST", "/pedido", p1);
j = await (await req("POST", "/admin/pedido/status", { id: p1.id, status: "retirado" }, K)).json(); ok(j.selo === null, "pedido sem cartão não gera selo");
let lim = 0; for (let i = 0; i < 14; i++) { r = await req("POST", "/pedido", ped(), { ip: "9.9.9.9" }); if (r.status === 429) lim++; }
ok(lim === 2, "limite de pedidos por hora no mesmo IP");
j = await (await req("GET", "/admin/clientes", null, K)).json(); ok(Array.isArray(j.clientes), "lista de clientes com selos");
