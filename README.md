# NS Gourmet — Cardápio Digital

Portal público de pedidos da NS Gourmet. O frontend é servido por Cloudflare Workers Static Assets e as rotas públicas de pedido são executadas pelo mesmo Worker. O banco e as regras de negócio continuam no Supabase.

## Arquitetura

- **Cloudflare Workers + Static Assets:** entrega de HTML, CSS, JavaScript e API.
- **Supabase PostgreSQL:** mantém cardápio, configurações, taxas de entrega, pedidos e itens.
- **RPCs existentes:** `public_order_menu()` e `create_public_order(p_order jsonb)`. O Worker chama essas funções pelo endpoint PostgREST.
- **Credenciais:** a URL do projeto é uma variável não secreta do Wrangler; `SUPABASE_SERVICE_ROLE_KEY` fica como secret do Worker. A chave privilegiada nunca é incluída nos arquivos públicos.

## Área administrativa

- Acesse `/admin`; o Worker entrega o login quando não existe sessão válida.
- O login usa o usuário existente no Supabase Auth (`ns_gourmet@profissional.com`) e valida a senha diretamente no Supabase. Não há senha administrativa hardcoded no código.
- Apenas o e-mail administrativo permitido em `ADMIN_EMAIL` pode entrar. A sessão usa cookies `HttpOnly`, `Secure` e `SameSite=Strict`, com refresh token guardado em cookie HttpOnly.
- O painel consome APIs do Worker; pedidos, produtos, taxas e configurações são lidos e gravados no Supabase Omega. As imagens são enviadas ao bucket público existente `product-images`.
- A migração `20261122070000_admin_cloudflare_workers.sql` adiciona somente colunas administrativas e estende a RPC pública para devolver o banner. Não recria tabelas nem remove dados.

### APIs administrativas protegidas

- `/api/admin/session`, `/api/admin/login`, `/api/admin/logout`
- `/api/admin/overview`, `/api/admin/orders`, `/api/admin/orders/:id`
- `/api/admin/products`, `/api/admin/products/:id`
- `/api/admin/delivery-rates`, `/api/admin/delivery-rates/:neighborhood`
- `/api/admin/store-config`

## Rotas do Worker

| Método | Rota | Função |
|---|---|---|
| GET | `/api/public-order/menu` | Lê o cardápio pela RPC `public_order_menu`. |
| POST | `/api/public-order/orders` | Registra pedido pela RPC `create_public_order`. |

O banco continua responsável por recalcular preços e frete, validar produtos disponíveis, horário de atendimento e idempotência. O Worker não aceita valores de total enviados pelo navegador.

## WhatsApp e banners do cardápio

- Depois de registrar o pedido no Supabase, o Worker prepara um link `wa.me` com o resumo confirmado. O cliente decide quando abrir e enviar a mensagem; o registro do pedido não depende do WhatsApp.
- A gestão configura número de destino, nome exibido, ativação do botão e modelo de mensagem com variáveis como `{{cliente}}`, `{{pedido}}`, `{{produtos}}`, `{{total}}` e `{{endereco}}`.
- A gestão permite cadastrar até seis banners no carrossel, reordenar/remover imagens e configurar intervalo entre 2 e 30 segundos (padrão: 3 segundos). As imagens ficam no bucket Supabase Storage `product-images`.
- A migration `20261126000100_whatsapp_checkout_and_hero_carousel.sql` é aditiva. Aplique-a no projeto Supabase Omega antes de habilitar os novos controles na gestão. Não é necessário recriar tabelas nem alterar pedidos existentes.

## Configuração local

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm run check
npm test
npx wrangler dev
```

Para testar as rotas localmente, copie `.dev.vars.example` para `.dev.vars` e preencha `SUPABASE_SERVICE_ROLE_KEY` com uma chave de desenvolvimento. Não use uma chave de produção em testes locais que possam gravar pedidos.

## Secret de produção

Depois de confirmar o Worker de destino, cadastre a chave privilegiada diretamente no Cloudflare:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

O comando solicita o valor interativamente. Não cole a chave no GitHub, em arquivos versionados ou no chat. A chave privilegiada do Supabase nunca deve aparecer no navegador.

## Publicação

```bash
npm run deploy:dry
npm run deploy
```

O primeiro comando valida o empacotamento sem publicar. Faça o deploy somente depois de configurar o secret no ambiente correto e validar a URL de preview.

## Compatibilidade com Supabase

Este projeto reutiliza o projeto Supabase **Omega** e as funções SQL já aplicadas. A migração do backend HTTP para Workers não exige recriar tabelas, copiar dados ou aplicar novas migrations. As políticas RLS e as permissões das RPCs existentes permanecem sob controle do banco.

## Limites conhecidos

- O portal público utiliza somente as duas rotas listadas acima. As rotas administrativas do mock-server local não são migradas por esta entrega.
- O formulário permite indicar bairro não cadastrado e estimativa de distância, mas a RPC atual do banco aceita somente bairros cadastrados em `public_order_delivery_rates`. Esse comportamento precisa de uma decisão e implementação específica no banco antes de oferecer frete por distância em produção.
- O estado atual da configuração Supabase está com `accepting_orders = false`; o banco rejeitará novos pedidos até que a loja seja reaberta pela configuração administrativa. Isso não foi alterado.
- O Worker aplica rate limiting aproximado de 12 envios por IP a cada 60 segundos em cada localização Cloudflare. A contagem é eventualmente consistente e não equivale a um limite global estrito.

## Desenvolvimento

O `mock-server.js` continua disponível apenas para demonstração local. A integração real em produção passa pelo Worker e pelas RPCs do Supabase.
