# Painel administrativo Omega — NS Gourmet

O painel fica em `/admin` e usa o Worker existente. O cardápio público permanece em `/` e `/pedido`.

## Autenticação necessária
- Criar manualmente o usuário em Supabase Dashboard → Authentication → Users → Add user.
- Usar o e-mail administrativo configurado em `ADMIN_EMAIL` no Worker e definir uma senha forte.
- O Worker autoriza somente o e-mail administrativo definido em `ADMIN_EMAIL` no arquivo `worker.js`.
- A chave `SUPABASE_SERVICE_ROLE_KEY` permanece exclusivamente como secret do Worker. Nunca copiar para HTML, CSS ou JavaScript.
- O Worker usa a API Auth do Supabase para validar a sessão e só permite o e-mail explicitamente autorizado.

## Rotas
- `GET /admin`: painel.
- `POST /api/admin/login`: autenticação.
- `GET /api/admin/me`: valida sessão.
- `GET /api/admin/data`: pedidos, itens, produtos, configurações e taxas.
- `PATCH /api/admin/orders/:id`: atualização de status.
- `POST /api/admin/products`, `PATCH /api/admin/products/:id`, `DELETE /api/admin/products/:id`.
- `PUT /api/admin/settings`: configurações da loja e horários.
- `POST /api/admin/rates`, `DELETE /api/admin/rates/:neighborhood`.

O painel inicial gerencia as tabelas públicas já existentes. Financeiro, estoque com movimentações e cadastro de clientes serão uma etapa posterior, pois não existem tabelas correspondentes no schema atual.
