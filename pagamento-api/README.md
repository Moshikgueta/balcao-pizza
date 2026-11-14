# Pagamento com Stone (via Pagar.me)

A Stone vende online por dois caminhos. O site da Balcão está pronto para os dois.

| | Link de pagamento Stone | Checkout Pagar.me (API da Stone) |
|---|---|---|
| Precisa de servidor? | Não | Sim (este Worker) |
| Valor exato de cada pedido | Não, o link é criado no app | Sim, calculado aqui |
| Confirmação automática | Não, a Balcão confere no app Stone | Sim, aviso do Pagar.me + conferência na API |
| Pix e cartão | Sim (Pix exige chave Pix cadastrada na Conta Stone) | Sim |

## Caminho 1 — Link de pagamento Stone (sem servidor)

1. No app Stone ou em conta.stone.com.br, crie um **link de pagamento**.
2. Em `index.html`, no `CONFIG.payment`:
   ```js
   payment: { enabled: true, provider: "stone", mode: "link", url: "https://SEU-LINK-STONE", ... }
   ```
3. O cliente envia o pedido no WhatsApp e toca em "Pagar". A Balcão confere o valor e o código do pedido no app Stone antes de preparar.

> Confira no app como o link Stone funciona hoje: se é de uso único, se tem valor fixo ou se o cliente digita o valor. Isso muda o quanto este caminho serve para pedidos de valores diferentes.

## Caminho 2 — Checkout Pagar.me com valor exato (recomendado)

A Balcão precisa de uma conta Pagar.me (a plataforma online da Stone) e das chaves de API: a de teste (`sk_test_...`) e a de produção.

1. **Banco:** Cloudflare → D1 → Create database `pagamento-balcao` → aba Console → cole `schema.sql` → Execute.
2. **Worker:** Workers & Pages → Create Worker `pagamento-balcao` → Edit code → cole `worker.js` → Deploy.
3. **Ligações (Settings):**
   - Binding D1 `DB` → banco `pagamento-balcao`
   - Secret `PAGARME_SECRET_KEY` → comece com a chave **de teste**
   - Secret `ADMIN_KEY` → uma senha forte para ver os pedidos
4. **Aviso de pagamento:** no painel do Pagar.me, cadastre um webhook para `https://pagamento-balcao.SUA-CONTA.workers.dev/webhook`, com os eventos de pedido pago, cancelado e com falha.
5. **Ligar no site** (`index.html`):
   ```js
   payment: { enabled: true, provider: "stone", mode: "checkout", url: "https://pagamento-balcao.SUA-CONTA.workers.dev/checkout", ... }
   ```
6. **Ver os pedidos:** `https://pagamento-balcao.SUA-CONTA.workers.dev/pedidos?key=SUA_SENHA`. Não compartilhe esse link.

### Antes de ir para produção

- Confira os campos do pedido em `pagarmeCriarPedido` com a documentação atual do Pagar.me (docs.pagar.me, "Criar pedido" e "Checkout"). Eles seguem a API Core v5, mas a API pode ter mudado.
- Faça pedidos de teste com a chave `sk_test` e confirme: a página de pagamento abre com o valor certo, o webhook chega e `/pedidos` mostra "pago".
- Os preços ficam em `PRECOS`, no `worker.js`. **Se mudar um preço no site, mude aqui também.** O servidor cobra o preço dele, nunca o que vem do navegador.
- Só troque para a chave de produção depois que tudo funcionar no teste.

## Testar localmente

`node pagamento-api/test.mjs` simula o Pagar.me e confere: preço recalculado no servidor, pedido repetido, pedido abaixo do mínimo, sabor inexistente e o webhook só marcando "pago" depois de consultar a API.
