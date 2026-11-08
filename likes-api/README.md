# API de curtidas (Cloudflare Worker + D1)

Guarda as curtidas do modo feed dos sites da **Balcão** e do **El Tumi** num banco de dados próprio, de graça.

- 1 curtida por pessoa por item; descurtir desconta.
- Não guarda dado pessoal: cada visitante recebe um código aleatório no navegador.
- Só aceita pedidos vindos de `https://moshikgueta.github.io`.
- Limite de 60 curtidas por visitante por dia.
- `/stats` com senha mostra o ranking e os últimos 7 dias para os donos.

## Publicar pelo painel da Cloudflare (sem instalar nada)

1. **Criar o banco:** *Storage & Databases → D1 → Create database* → nome `curtidas` → Create.
2. **Criar a tabela:** abra o banco → aba *Console* → cole o conteúdo de `schema.sql` → *Execute*.
3. **Criar o Worker:** *Workers & Pages → Create → Create Worker* → nome `curtidas` → *Deploy*.
4. **Colar o código:** no Worker, *Edit code* → apague tudo → cole o conteúdo de `worker.js` → *Deploy*.
5. **Ligar o banco:** no Worker, *Settings → Bindings → Add → D1 database* → Variable name `DB` → banco `curtidas` → Save/Deploy.
6. **Senha dos números:** *Settings → Variables and Secrets → Add* → tipo *Secret*, nome `ADMIN_KEY`, uma senha forte → Deploy.
7. **Testar:** abra `https://curtidas.<sua-conta>.workers.dev/` → deve aparecer `{"ok":true,"api":"curtidas"}`.
8. **Ligar nos sites:** coloque esse endereço em
   - Balcão: `index.html` → `const LIKES_WORKER = "https://curtidas.<sua-conta>.workers.dev";`
   - El Tumi: `index.html` → `CONFIG.likesWorker: "https://curtidas.<sua-conta>.workers.dev",`

## Ver os números

`https://curtidas.<sua-conta>.workers.dev/stats?site=balcao&key=SUA_SENHA`
(troque `balcao` por `eltumi` para o café). Não compartilhe esse link: ele tem a senha.

## Adicionar um novo site

Em `worker.js`, acrescente o nome em `SITES` (ex.: `simhovich: /^[a-z0-9-]{2,60}$/,`) e, se o site estiver em outro domínio, em `ALLOWED_ORIGINS`.
