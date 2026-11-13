# Painel administrativo Omega — NS Gourmet

O painel administrativo fica em `/admin`. O cardápio público permanece em `/` e `/pedido`. A aplicação é servida pelo Cloudflare Worker e usa Supabase como banco e provedor de autenticação.

## Autenticação e segurança

- Crie a conta administrativa em Supabase Dashboard → Authentication → Users → Add user.
- O Worker autoriza apenas o endereço definido em `ADMIN_EMAIL` dentro de `worker.js`.
- O token de sessão é guardado em `sessionStorage` e validado no servidor em cada chamada administrativa.
- `SUPABASE_SERVICE_ROLE_KEY` deve permanecer exclusivamente como secret do Worker. Nunca incluir essa chave em HTML, CSS, JavaScript do navegador, commits ou logs.
- As tabelas administrativas novas têm RLS habilitado e políticas que negam acesso aos papéis públicos `anon` e `authenticated`. As operações passam pelo Worker autenticado.

## Módulos da dashboard

### Visão geral
Indicadores de pedidos, entradas recebidas, saldo do mês, estoque abaixo do mínimo e pedidos recentes.

### Pedidos e entregas
Consulta até 300 pedidos recentes, itens, endereço, bairro, forma de recebimento e pagamento. Permite alterar a etapa do pedido e o status financeiro separadamente. A tela de entregas filtra os pedidos de delivery e mostra sua etapa atual.

### Produtos
Cadastro e edição de nome, categoria, SKU, descrição pública, preço de venda, custo estimado, tempo de preparo, imagem e disponibilidade. A margem bruta estimada é calculada no navegador a partir de preço e custo informados. O custo do produto é copiado para o item no momento em que um novo pedido é criado, preservando o custo histórico daquele pedido.

### Clientes
Agrupa os dados de clientes a partir dos pedidos recentes carregados pela dashboard. Não é ainda um cadastro mestre independente: a visão fica limitada aos pedidos retornados pela API (até 300).

### Estoque
Cadastro de ingredientes e materiais, unidade de medida, quantidade mínima e custo base. Permite registrar entradas, saídas e ajustes. O banco atualiza o saldo automaticamente por trigger e rejeita saídas que deixariam saldo negativo. O histórico de movimentações é preservado.

### Financeiro
Livro-caixa para receitas e despesas com categoria, valor, vencimento, situação, forma de pagamento e observações. Lançamentos pendentes são exibidos separadamente dos valores pagos/recebidos. Lançamentos manuais podem ser marcados como pagos/recebidos ou anulados; a anulação preserva o registro histórico.

Quando o status de pagamento de um pedido online muda para `paid`, a RPC `admin_set_order_payment_status` cria ou atualiza automaticamente uma entrada de receita associada ao pedido. Ao voltar para `pending` ou `refunded`, a entrada vinculada é anulada, evitando somar o mesmo pedido duas vezes.

O saldo é gerencial e depende dos lançamentos informados. Não substitui escrituração contábil, conciliação bancária, emissão fiscal, folha de pagamento ou apuração tributária. Compras e despesas devem ser lançadas para que a visão de resultado seja útil.

### Relatórios
Resumo do mês, ticket médio, resultado financeiro, produtos mais vendidos, vendas por forma de pagamento e pedidos por etapa.

### Configurações
Nome e WhatsApp da loja, fuso horário, aceitação de pedidos, horários de funcionamento e taxas de entrega por bairro.

## Rotas administrativas

- `GET /admin`: interface da dashboard.
- `POST /api/admin/login`: autenticação.
- `GET /api/admin/me`: valida sessão.
- `GET /api/admin/data`: dados operacionais, catálogo, financeiro, estoque e configurações.
- `PATCH /api/admin/orders/:id`: atualiza etapa do pedido.
- `PATCH /api/admin/orders/:id/payment`: atualiza situação do pagamento e sincroniza o livro-caixa.
- `POST /api/admin/products`, `PATCH /api/admin/products/:id`, `DELETE /api/admin/products/:id`: catálogo.
- `PUT /api/admin/settings`: configurações da loja e horários.
- `POST /api/admin/rates`, `DELETE /api/admin/rates/:neighborhood`: taxas.
- `POST /api/admin/finance/entries`: lançamento manual financeiro.
- `PATCH /api/admin/finance/entries/:id`: marca pendente como pago ou anula lançamento manual.
- `POST /api/admin/inventory/items`, `PATCH /api/admin/inventory/items/:id`: itens de estoque.
- `POST /api/admin/inventory/movements`: movimentação de estoque.

## Migrations

As migrations administrativas ficam em `supabase/migrations/`:
- `20261113015506_admin_management_finance_inventory.sql`
- `20261113015518_index_admin_finance_category.sql`

Elas estendem o catálogo e os pedidos com campos de custo/pagamento, criam o livro-caixa e o estoque, adicionam a atualização de saldo por movimentação, configuram políticas de segurança e criam as categorias financeiras iniciais.

## Limitações atuais / próximos incrementos

- A aba Entregas é uma central operacional dos pedidos de delivery, mas não inclui cadastro de entregadores, distribuição de rotas ou rastreamento GPS.
- Clientes são agrupados a partir do histórico recente de pedidos; ainda não existe cadastro separado com edição de dados e ficha completa.
- O estoque é controlado por movimentos manuais; ainda não há ficha técnica/receita de produto que desconte automaticamente ingredientes ao concluir uma venda.
- O financeiro não integra bancos, adquirentes ou emissão fiscal. Para refletir o caixa real, é necessário registrar despesas, entradas externas e confirmar pagamentos de pedidos.
- O controle de acesso atual é para uma única conta administrativa autorizada pelo e-mail configurado no Worker.
