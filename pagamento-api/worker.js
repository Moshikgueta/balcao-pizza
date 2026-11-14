/**
 * API de pagamento da Balcão — Stone (via Pagar.me, a plataforma de pagamentos online da Stone)
 * Cloudflare Worker + banco D1. DESLIGADA até você configurar as chaves (veja README.md).
 *
 *   POST /checkout   pedido do site → cria o pedido no Pagar.me e devolve {"url": página de pagamento}
 *   POST /webhook    aviso do Pagar.me → confere o pedido direto na API e marca como pago no banco
 *   GET  /pedidos?key=SENHA   últimos pedidos e o status de pagamento (só para a pizzaria)
 *
 * Segurança:
 *   - O VALOR É RECALCULADO AQUI a partir da tabela PRECOS. O total que vem do navegador é ignorado.
 *   - "Pago" só é gravado depois de consultar o pedido na API do Pagar.me. O corpo do aviso
 *     (webhook) e o endereço de volta (?pagamento=ok) nunca são usados como prova de pagamento.
 *   - A chave secreta fica só como Secret no Cloudflare (PAGARME_SECRET_KEY), nunca no site.
 *
 * Configuração no painel da Cloudflare:
 *   - Binding D1             DB
 *   - Secret                 PAGARME_SECRET_KEY   (sk_test_... para testar, sk_... para produção)
 *   - Secret                 ADMIN_KEY            (senha para /pedidos)
 *   - Variável (opcional)    PAGARME_API = https://api.pagar.me/core/v5
 *
 * IMPORTANTE: os nomes dos campos do Pagar.me abaixo (em pagarmeCriarPedido e pagarmeLerPedido)
 * seguem a API Core v5. Antes de ligar, confira com a documentação atual (docs.pagar.me)
 * e faça um pedido de teste com a chave sk_test.
 */

const ALLOWED_ORIGINS = ["https://moshikgueta.github.io"];
const SITE_URL = "https://moshikgueta.github.io/balcao-pizza/";

// Preços em centavos. MANTENHA IGUAL ao MENU do index.html (se mudar lá, mude aqui).
const PRECOS = {
  "mussarela":    { nome: "Mussarela",            centavos: 4490 },
  "calabresa":    { nome: "Calabresa com Cebola", centavos: 4490 },
  "tres-queijos": { nome: "Três Queijos",         centavos: 4490 },
  "margherita":   { nome: "Margherita",           centavos: 4790 },
  "diavola":      { nome: "Diavola",              centavos: 4990 },
  "gorgonzola":   { nome: "Gorgonzola & Cogumelo", centavos: 4990 },
};
const PEDIDO_MINIMO = 2000;            // R$ 20,00
const MAX_POR_ITEM = 20;
const PAGAMENTO_EXPIRA_EM = 60 * 60;   // 1 hora, em segundos

function cors(req) {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const json = (req, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(req) } });

const ID_RE = /^B\d{4}-\d{4}-[A-Z0-9]{4}$/;

/** Monta os itens com o preço do servidor e confere o pedido. */
export function montarPedido(body) {
  if (!body || typeof body !== "object") throw new Error("pedido inválido");
  const id = String(body.id || "");
  if (!ID_RE.test(id)) throw new Error("código do pedido inválido");
  const nome = String(body.nome || "").trim().slice(0, 60);
  if (nome.length < 2) throw new Error("nome inválido");
  if (!Array.isArray(body.itens) || !body.itens.length || body.itens.length > 20) throw new Error("itens inválidos");
  const itens = body.itens.map(i => {
    const p = PRECOS[i && i.id];
    const qtd = Number(i && i.qtd);
    if (!p) throw new Error("sabor desconhecido");
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > MAX_POR_ITEM) throw new Error("quantidade inválida");
    return { id: i.id, nome: p.nome, qtd, centavos: p.centavos };
  });
  const total = itens.reduce((s, i) => s + i.qtd * i.centavos, 0);
  if (total < PEDIDO_MINIMO) throw new Error("pedido abaixo do mínimo");
  return { id, nome, itens, total, retirada: String(body.retirada || "").slice(0, 40) };
}

function auth(env) {
  return "Basic " + btoa(env.PAGARME_SECRET_KEY + ":");
}
const api = env => (env.PAGARME_API || "https://api.pagar.me/core/v5").replace(/\/$/, "");

/** Cria o pedido com checkout (página de pagamento do Pagar.me, Pix ou cartão). */
async function pagarmeCriarPedido(env, p, fetchFn) {
  const voltar = `${SITE_URL}?pagamento=ok&pedido=${encodeURIComponent(p.id)}`;
  const corpo = {
    code: p.id,
    closed: true,
    items: p.itens.map(i => ({ code: i.id, description: i.nome, amount: i.centavos, quantity: i.qtd })),
    customer: { name: p.nome, type: "individual" },
    payments: [{
      payment_method: "checkout",
      amount: p.total,
      checkout: {
        expires_in: PAGAMENTO_EXPIRA_EM,
        accepted_payment_methods: ["pix", "credit_card"],
        success_url: voltar,
        customer_editable: true,          // o cliente completa e-mail/CPF na página do Pagar.me
        billing_address_editable: false,
        skip_checkout_success_page: false,
        pix: { expires_in: PAGAMENTO_EXPIRA_EM },
        credit_card: { operation_type: "auth_and_capture", installments: [{ number: 1, total: p.total }] },
      },
    }],
    metadata: { site: "balcao", retirada: p.retirada },
  };
  const r = await fetchFn(api(env) + "/orders", {
    method: "POST",
    headers: { "Authorization": auth(env), "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("pagarme " + r.status + " " + (j.message || ""));
  const url = j.checkouts && j.checkouts[0] && j.checkouts[0].payment_url;
  if (!url) throw new Error("pagarme sem payment_url");
  return { pagarmeId: j.id, url };
}

/** Lê o pedido direto na API (é isso que vale como prova de pagamento). */
async function pagarmeLerPedido(env, pagarmeId, fetchFn) {
  const r = await fetchFn(api(env) + "/orders/" + encodeURIComponent(pagarmeId), { headers: { "Authorization": auth(env) } });
  if (!r.ok) throw new Error("pagarme " + r.status);
  const j = await r.json();
  return { pagarmeId: j.id, code: j.code, status: j.status, amount: j.amount };
}

export async function handle(req, env, fetchFn = fetch) {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (!env.PAGARME_SECRET_KEY) return json(req, { error: "pagamento não configurado" }, 503);

  if (req.method === "POST" && url.pathname === "/checkout") {
    if (!ALLOWED_ORIGINS.includes(req.headers.get("Origin") || "")) return json(req, { error: "origem não permitida" }, 403);
    let p;
    try { p = montarPedido(await req.json()); } catch (e) { return json(req, { error: e.message }, 400); }
    const ja = await env.DB.prepare("SELECT url FROM pedidos WHERE id = ?").bind(p.id).first();
    if (ja && ja.url) return json(req, { url: ja.url });              // mesmo pedido, mesmo link
    try {
      const r = await pagarmeCriarPedido(env, p, fetchFn);
      await env.DB.prepare("INSERT INTO pedidos (id, pagarme_id, nome, itens, total, status, url, criado_em) VALUES (?,?,?,?,?,?,?,?)")
        .bind(p.id, r.pagarmeId, p.nome, JSON.stringify(p.itens), p.total, "aguardando", r.url, new Date().toISOString()).run();
      return json(req, { url: r.url });
    } catch (e) {
      console.log("checkout falhou", e.message);
      return json(req, { error: "não foi possível criar o pagamento" }, 502);
    }
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    let ev; try { ev = await req.json(); } catch { return new Response("ok"); }
    const pagarmeId = ev && ev.data && (ev.data.order ? ev.data.order.id : ev.data.id);
    if (!pagarmeId || !/^or_/.test(String(pagarmeId))) return new Response("ok");
    try {
      const o = await pagarmeLerPedido(env, pagarmeId, fetchFn);          // confere na fonte
      const row = await env.DB.prepare("SELECT id, total FROM pedidos WHERE pagarme_id = ?").bind(o.pagarmeId).first();
      if (row) {
        const status = o.status === "paid" && o.amount === row.total ? "pago" : o.status === "canceled" || o.status === "failed" ? "cancelado" : "aguardando";
        await env.DB.prepare("UPDATE pedidos SET status = ?, atualizado_em = ? WHERE id = ?").bind(status, new Date().toISOString(), row.id).run();
      }
    } catch (e) { console.log("webhook", e.message); }
    return new Response("ok");                                            // sempre 200 para o Pagar.me não reenviar sem fim
  }

  if (req.method === "GET" && url.pathname === "/pedidos") {
    if (!env.ADMIN_KEY || url.searchParams.get("key") !== env.ADMIN_KEY) return json(req, { error: "senha" }, 401);
    const { results } = await env.DB.prepare("SELECT id, nome, total, status, criado_em, atualizado_em FROM pedidos ORDER BY criado_em DESC LIMIT 50").all();
    return json(req, { pedidos: results.map(r => ({ ...r, total: (r.total / 100).toFixed(2) })) });
  }

  if (req.method === "GET" && url.pathname === "/") return json(req, { ok: true, api: "pagamento-balcao" });
  return json(req, { error: "não encontrado" }, 404);
}

export default { fetch: (req, env) => handle(req, env) };
