# Migração Cloudflare — NS Gourmet

Esta branch prepara o **cardápio público** NS Gourmet para Cloudflare Workers + Static Assets.
Ela não substitui nem migra o painel administrativo completo do Gestor Omega.

## Arquitetura

- HTML, CSS, JavaScript e favicon servidos por Cloudflare Workers Static Assets.
- Rotas `/api/public-order/menu`, `/api/public-order/orders` e `/api/health` executadas pelo Worker.
- PostgreSQL, tabelas e funções continuam no Supabase.
- A chave `SUPABASE_SERVICE_ROLE_KEY` fica somente como secret do Worker; nunca no navegador ou no Git.
- O Worker chama as funções RPC já existentes `public_order_menu()` e `create_public_order(p_order jsonb)`.

## Desenvolvimento local

1. Copie `.dev.vars.example` para `.dev.vars`.
2. Preencha a URL e a chave service role apenas no arquivo local `.dev.vars`.
3. Execute `npm run cf:dev`.
4. Teste `http://localhost:8787/pedido`, `/api/health` e o carregamento do cardápio.
5. Não envie pedidos reais em testes locais.

## Publicação de teste

Na Cloudflare, conecte este repositório em **Workers & Pages > Create > Workers** e selecione a branch `migration/cloudflare-workers`.

- Root directory: `/`
- Build command: deixar vazio
- Deploy command: `npx wrangler@latest deploy`
- O nome do Worker precisa corresponder a `ns-gourmet-omega`, definido em `wrangler.jsonc`.

Configure os secrets do Worker antes de testar as APIs:

```sh
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Os valores devem ser os do projeto Supabase **Omega** correto. Não coloque a service role key em arquivo versionado, variável `VITE_*`, HTML ou JavaScript público.

## Rotas

- `GET /api/health`: verifica a disponibilidade do Worker e a conectividade com o RPC do cardápio, sem retornar dados de clientes.
- `GET /api/public-order/menu`: lê o cardápio pelo RPC do Supabase.
- `POST /api/public-order/orders`: registra pedido pelo RPC do Supabase; o banco recalcula preços/frete e valida expediente.

## Limites e pendências antes de produção

- Esta branch é uma preparação de migração; não foi publicado nem recebeu secrets.
- A branch de origem contém somente a interface pública/cardápio, não o painel administrativo completo.
- As migrations de pedidos públicas já constam no histórico do projeto Supabase Omega e as funções RPC foram verificadas como existentes. Nenhuma migration foi aplicada nesta migração.
- Revisar as configurações reais da loja, catálogo e taxas antes de liberar pedidos.
- Validar a política de privacidade e o link de contato antes da publicação.
- Testar menu, horários, pedidos idempotentes, entrega/retirada, erros e mobile em preview.
- Manter a Vercel e o domínio atual intactos até aprovação expressa do usuário.

## Comandos

- `npm run cf:dev`
- `npm run cf:deploy` (somente depois de configurar os secrets e revisar o ambiente de destino)
