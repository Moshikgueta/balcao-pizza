/**
 * API de curtidas — Cloudflare Worker + banco D1
 * Serve vários sites ao mesmo tempo (ex.: "balcao" e "eltumi").
 *
 *   GET  /counts?site=balcao                 → {"counts":{"margherita":12,...}}
 *   POST /like   {"site","item","uid","on"}  → {"item":"margherita","count":13}
 *   GET  /stats?site=balcao&key=SENHA        → totais e últimos 7 dias (só para a pizzaria)
 *
 * "uid" é um código aleatório criado no navegador do visitante (não é nome,
 * telefone nem nenhum dado pessoal). Cada uid conta no máximo 1 curtida por item,
 * e descurtir desconta.
 *
 * Configuração no painel da Cloudflare:
 *   - Binding D1 com o nome  DB
 *   - Variável (Secret)       ADMIN_KEY  (senha para /stats)
 */

// Só estes sites podem usar a API pelo navegador.
const ALLOWED_ORIGINS = [
  "https://moshikgueta.github.io",
];
// Sites e itens aceitos (evita lixo no banco).
const SITES = {
  balcao: /^[a-z0-9-]{2,40}$/,
  eltumi: /^[a-z0-9-]{2,60}$/,
};
const UID_RE = /^[a-zA-Z0-9_-]{16,64}$/;
const MAX_LIKES_PER_UID_PER_DAY = 60;

function cors(req) {
  const o = req.headers.get("Origin") || "";
  const allow = ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const json = (req, data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(req), ...extra } });

async function counts(env, site) {
  const { results } = await env.DB.prepare(
    "SELECT item, COUNT(*) AS c FROM likes WHERE site = ? GROUP BY item"
  ).bind(site).all();
  const out = {};
  for (const r of results || []) out[r.item] = Number(r.c);
  return out;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

    try {
      if (req.method === "GET" && url.pathname === "/counts") {
        const site = url.searchParams.get("site");
        if (!SITES[site]) return json(req, { error: "site inválido" }, 400);
        return json(req, { counts: await counts(env, site) }, 200, { "Cache-Control": "public, max-age=15" });
      }

      if (req.method === "POST" && url.pathname === "/like") {
        const origin = req.headers.get("Origin");
        if (origin && !ALLOWED_ORIGINS.includes(origin)) return json(req, { error: "origem não permitida" }, 403);
        let b; try { b = await req.json(); } catch { return json(req, { error: "json inválido" }, 400); }
        const { site, item, uid } = b || {}; const on = b && b.on !== false;
        if (!SITES[site] || !SITES[site].test(item || "") || !UID_RE.test(uid || "")) return json(req, { error: "dados inválidos" }, 400);

        if (on) {
          const day = new Date().toISOString().slice(0, 10);
          const n = await env.DB.prepare("SELECT COUNT(*) AS c FROM likes WHERE uid = ? AND substr(created_at,1,10) = ?").bind(uid, day).first();
          if (n && Number(n.c) >= MAX_LIKES_PER_UID_PER_DAY) return json(req, { error: "limite diário" }, 429);
          await env.DB.prepare("INSERT OR IGNORE INTO likes (site, item, uid, created_at) VALUES (?, ?, ?, ?)")
            .bind(site, item, uid, new Date().toISOString()).run();
        } else {
          await env.DB.prepare("DELETE FROM likes WHERE site = ? AND item = ? AND uid = ?").bind(site, item, uid).run();
        }
        const c = await env.DB.prepare("SELECT COUNT(*) AS c FROM likes WHERE site = ? AND item = ?").bind(site, item).first();
        return json(req, { item, count: Number(c ? c.c : 0) });
      }

      if (req.method === "GET" && url.pathname === "/stats") {
        const site = url.searchParams.get("site");
        if (!env.ADMIN_KEY || url.searchParams.get("key") !== env.ADMIN_KEY) return json(req, { error: "senha incorreta" }, 401);
        if (!SITES[site]) return json(req, { error: "site inválido" }, 400);
        const since = new Date(Date.now() - 7 * 864e5).toISOString();
        const { results } = await env.DB.prepare(
          "SELECT item, COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS ultimos_7_dias FROM likes WHERE site = ? GROUP BY item ORDER BY total DESC"
        ).bind(since, site).all();
        return json(req, { site, itens: results || [] });
      }

      if (url.pathname === "/") return json(req, { ok: true, api: "curtidas" });
      return json(req, { error: "não encontrado" }, 404);
    } catch (e) {
      return json(req, { error: "erro no servidor" }, 500);
    }
  },
};
