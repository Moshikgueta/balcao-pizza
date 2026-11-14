# Pagamento online (pronto para ligar)

> **Stone:** o site já vem configurado para a Stone (`provider: "stone"`). O passo a passo completo, com o servidor do Pagar.me (a plataforma online da Stone), está em [`pagamento-api/README.md`](pagamento-api/README.md).

O site já tem o lugar para pagamento online, mas ele está **desligado**. Hoje o cliente paga na retirada (Pix, cartão ou dinheiro) e nada muda até você ligar.

Quando ligar, aparece a opção **"Pagar online agora (Pix ou cartão)"** no pedido. O cliente envia o pedido no WhatsApp como sempre e, em seguida, aparece o botão **"Pagar R$ XX agora"**, que abre a página de pagamento.

Tudo fica em `index.html`, no bloco `CONFIG.payment`:

```js
payment: {
  enabled: false,
  mode: "link",
  url: "",
  label: "Pagar online agora (Pix ou cartão)",
  returnMessage: "Pagamento enviado! ..."
},
```

## Jeito 1 — link de pagamento (mais simples, sem servidor)

Serve para quem já tem conta em Mercado Pago, InfinitePay, PagSeguro, Stripe etc.

1. Crie no app do provedor um **link de pagamento**.
2. Se o provedor aceitar o valor no próprio link, use as marcações abaixo; o site troca pelos dados do pedido:
   - `{total}` → valor com ponto, ex.: `89.80`
   - `{centavos}` → valor em centavos, ex.: `8980`
   - `{pedido}` → código do pedido, ex.: `B1411-1932-K7QZ` (o mesmo que vai na mensagem do WhatsApp)
   - `{nome}` → nome do cliente
3. Se o link tiver **valor fixo ou aberto** (o cliente digita o valor), coloque o link do jeito que ele é.
4. Preencha e ligue:

```js
payment: { enabled: true, mode: "link", url: "https://SEU-LINK-DE-PAGAMENTO", ... }
```

> Cada provedor tem regras diferentes para o link. Confira no painel do provedor se o valor pode ir no link.

## Jeito 2 — checkout com servidor (valor exato e confirmação automática)

Para o valor sair exato em cada pedido e a confirmação chegar sozinha, é preciso um pequeno servidor (por exemplo, um Cloudflare Worker como o de `likes-api/`).

O site faz `POST` para o endereço em `url` com este corpo:

```json
{
  "id": "B1411-1932-K7QZ",
  "total": 89.8,
  "nome": "Ana",
  "itens": [{ "id": "margherita", "nome": "Margherita", "qtd": 2, "preco": 47.9, "obs": "" }],
  "retirada": "19:30",
  "voltar": "https://moshikgueta.github.io/balcao-pizza/?pagamento=ok&pedido=B1411-1932-K7QZ"
}
```

O servidor cria o pagamento no provedor e responde:

```json
{ "url": "https://pagina-de-pagamento-do-provedor" }
```

Regras de segurança para o servidor:
- **Recalcule o total no servidor** a partir dos ids e das quantidades. Nunca confie no valor que vem do navegador.
- **A confirmação do pagamento vem do provedor** (webhook ou consulta à API), nunca do endereço de volta `?pagamento=ok`. Esse endereço só mostra um agradecimento ao cliente.
- A chave secreta do provedor fica só no servidor, nunca no `index.html`.

Depois:

```js
payment: { enabled: true, mode: "checkout", url: "https://SEU-SERVIDOR/criar-pagamento", ... }
```

## Testar

Antes de divulgar, faça um pedido de valor baixo e confira:
1. A mensagem do WhatsApp diz `Pagamento: online · pedido B....`.
2. O botão "Pagar R$ XX agora" abre o pagamento com o valor certo.
3. O pagamento aparece no app do provedor com o mesmo código do pedido.
