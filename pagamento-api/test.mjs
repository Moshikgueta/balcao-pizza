// Teste local do Worker de pagamento, com Pagar.me e D1 simulados. Uso: node pagamento-api/test.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { handle } from "./worker.js";

const db = new DatabaseSync(":memory:");
db.exec(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const DB = { prepare(sql) { let a = []; const st = db.prepare(sql); return { bind(...x) { a = x; return this; }, async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) ?? null; }, async run() { return st.run(...a); } }; } };
const env = { DB, PAGARME_SECRET_KEY: "sk_test_x", ADMIN_KEY: "k" };

let criados = [], status = {};
async function fakeFetch(url, init = {}) {
  if (url.endsWith("/orders") && init.method === "POST") {
    const b = JSON.parse(init.body); criados.push(b);
    const id = "or_" + criados.length; status[id] = { id, code: b.code, status: "pending", amount: b.payments[0].amount };
    return new Response(JSON.stringify({ id, checkouts: [{ payment_url: "https://pagar.me/checkout/" + id }] }), { status: 200 });
  }
  const m = url.match(/\/orders\/(or_\d+)$/);
  if (m) return new Response(JSON.stringify(status[m[1]]), { status: 200 });
  return new Response("{}", { status: 404 });
}
const O = "https://moshikgueta.github.io";
const post = (path, body, origin = O) => handle(new Request("https://w.test" + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }), env, fakeFetch);
const ok = (c, m) => { console.log((c ? "ok   " : "FALHA") + " " + m); if (!c) process.exitCode = 1; };

const pedido = { id: "B1411-1932-K7QZ", nome: "Ana", total: 0.01, itens: [{ id: "margherita", qtd: 2, preco: 0.01 }] };
let r = await post("/checkout", pedido); let j = await r.json();
ok(r.status === 200 && j.url.includes("or_1"), "cria checkout e devolve a página de pagamento");
ok(criados[0].payments[0].amount === 9580, "total recalculado no servidor (R$ 95,80), ignorando o valor do navegador");
r = await post("/checkout", pedido); j = await r.json();
ok(criados.length === 1 && j.url.includes("or_1"), "pedido repetido reaproveita o mesmo pagamento");
r = await post("/checkout", { ...pedido, id: "B1411-1932-AAAA", itens: [{ id: "pizza-falsa", qtd: 1 }] });
ok(r.status === 400, "sabor inexistente é recusado");
r = await post("/checkout", { ...pedido, id: "B1411-1932-BBBB", itens: [{ id: "margherita", qtd: 0 }] });
ok(r.status === 400, "quantidade inválida é recusada");
r = await post("/checkout", pedido, "https://site-estranho.com");
ok(r.status === 403, "outro site não consegue criar pagamento");

await post("/webhook", { type: "order.paid", data: { id: "or_1", status: "paid" } });
let row = db.prepare("SELECT status FROM pedidos WHERE id = ?").get(pedido.id);
ok(row.status === "aguardando", "aviso falso de 'pago' não vale: a API ainda diz pendente");
status.or_1.status = "paid";
await post("/webhook", { type: "order.paid", data: { id: "or_1" } });
row = db.prepare("SELECT status FROM pedidos WHERE id = ?").get(pedido.id);
ok(row.status === "pago", "marca pago depois de conferir na API");

r = await handle(new Request("https://w.test/pedidos?key=errada"), env, fakeFetch);
ok(r.status === 401, "lista de pedidos exige senha");
r = await handle(new Request("https://w.test/pedidos?key=k"), env, fakeFetch); j = await r.json();
ok(j.pedidos[0].total === "95.80" && j.pedidos[0].status === "pago", "lista de pedidos para a pizzaria");
r = await handle(new Request("https://w.test/checkout", { method: "POST" }), { DB }, fakeFetch);
ok(r.status === 503, "sem chave configurada, o pagamento fica desligado");
