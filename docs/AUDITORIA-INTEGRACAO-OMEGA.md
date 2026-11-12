# Auditoria de integração — NS Gourmet / Gestor Omega

Data: 12/11/2026

## Escopo analisado

Pacote recebido: `Ns_Gourmet_gestor_Omega-main.zip`.

O ZIP foi aberto e contém a interface do cardápio, APIs públicas, biblioteca Supabase, schema SQL, testes, configuração Vercel, servidor de demonstração e documentação.

## Repositório de destino confirmado

`Olivzx/Ns_Gourmet_gestor_Omega` — branch principal `main`.

O estado atual do repositório contém uma base do cardápio público, mas não contém `server.js`, nem a implementação do backend do Gestor Omega que o script `INTEGRAR-OMEGA.ps1` exige encontrar. Portanto, não é possível confirmar que este repositório seja o código-fonte completo do Gestor Omega operacional.

## Validações executadas no pacote

- `node --check mock-server.js`: aprovado.
- `node --check pedido.js`: aprovado.
- `node --check lib/supabase.js`: aprovado.
- `node --check api/public-order/menu.js`: aprovado.
- `node --check api/public-order/orders.js`: aprovado.
- `node --test`: 4 testes aprovados.

Os testes atuais cobrem apenas métodos HTTP inválidos, JSON malformado e ausência de configuração do Supabase. Eles não comprovam um fluxo de pedido real nem integração com o Gestor Omega.

## Bloqueios técnicos antes de integrar ou publicar

1. **Backend Omega não localizado neste repositório:** o script de integração requer `server.js`, mas esse arquivo não existe na árvore atual. Não executar o script sem localizar o repositório/versão correta do backend.
2. **Persistência paralela:** `supabase/schema.sql` cria tabelas próprias `public_orders`, `public_order_items`, `public_order_products` e `public_store_settings`. Isso pode duplicar o modelo de pedidos já existente no Omega e contradiz a documentação que diz não precisar de novas tabelas.
3. **Horário comercial:** a função SQL bloqueia por `accepting_orders`, mas não avalia o expediente semanal em `business_hours`. O horário exibido no navegador não substitui validação de servidor.
4. **Proteção de API:** os handlers não implementam, neste pacote, validação de origem/CSRF ou rate limiting, apesar de a documentação mencionar que esses controles devem ser preservados. É necessário verificar se há middleware externo no backend real antes de decidir como aplicar.
5. **Notificações:** a criação de pedido no SQL não implementa notificação ao painel/loja.
6. **Integração com pedidos existentes:** a função SQL cria registros nas tabelas próprias do pacote; não há evidência de que os pedidos sejam inseridos no fluxo/tabelas/status já usados pelo Omega.
7. **Dados comerciais:** o schema começa com loja sem configuração e pedidos desativados; catálogo, taxas, contatos, expediente e políticas ainda precisam ser validados/preenchidos.
8. **Segredos:** `SUPABASE_SERVICE_ROLE_KEY` deve existir somente em variável de ambiente server-side. Nunca publicar seu valor no repositório ou no navegador.

## Estado seguro

- Nenhuma migração SQL foi executada.
- Nenhuma variável de ambiente foi alterada.
- Nenhuma configuração Vercel foi alterada.
- Nenhuma hospedagem ou publicação foi iniciada.
- Nenhuma alteração foi feita na branch `main`.

## Próxima ação necessária

Localizar e confirmar o repositório/versão do **backend real do Gestor Omega** (o que contém `server.js` e as rotas de pedidos existentes). Só então adaptar o cardápio para reutilizar o fluxo de pedidos, catálogo, regras de horário, notificações e persistência já existentes, evitando criar uma segunda base independente.
