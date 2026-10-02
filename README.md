# Plataforma de pagamentos distribuídos — simulador

Base funcional de uma plataforma **exclusivamente simulada**. Não movimenta dinheiro, não chama adquirentes/bancos e não recebe dados de cartão. `CARD` e `PIX` são apenas modalidades fictícias. O saldo é uma obrigação contábil simulada, não uma conta bancária.

## Escopo desta primeira versão

- Cadastro de merchants (recebedores).
- Criação e consulta de pagamentos em BRL, com valores inteiros em centavos.
- Cenários determinísticos `APPROVED` e `DECLINED`.
- Estorno integral, assíncrono, único por pagamento.
- Ledger de partidas dobradas, balanceado no commit e append-only.
- Saldo por merchant e trilha de eventos do pagamento.
- API e workers separados; vários workers podem rodar simultaneamente.
- Idempotência, transactional outbox, publisher confirms, deduplicação e fila de falhas.

Esta é a fundação de um projeto maior, **não uma plataforma completa ou pronta para produção**. Dashboard, usuários/RBAC, split, transferências, estornos parciais, webhooks assinados, reconciliação, cenários de timeout e métricas são próximos incrementos.

## Stack e fluxo

TypeScript / NestJS / PostgreSQL / RabbitMQ.

```text
Cliente → API → PostgreSQL (pagamento + outbox na mesma transação)
                         ↓
              Worker publica outbox → RabbitMQ
                                         ↓
                Worker consome → dedup + pagamento + ledger + auditoria
                                 em uma transação PostgreSQL
```

A entrega é **at-least-once**, não exactly-once. Se o processo cair depois de publicar e antes de marcar a outbox, o evento é publicado novamente; `processed_events` elimina a duplicação de efeitos. Publisher confirms precedem o registro de publicação. A simulação é local/determinística, sem efeito externo cuja transação precise ser reconciliada.

Máquina de estados:

```text
PENDING → SUCCEEDED → REFUND_PENDING → REFUNDED
       ↘ FAILED
```

Pagamento aprovado: débito `provider_clearing`, crédito `merchant_payable`. Estorno: lançamentos inversos. Falhas não geram lançamentos. Valores monetários retornados do PostgreSQL aparecem como strings nas respostas para preservar precisão.

## Executar localmente

Requisitos: Node.js 22+, Docker Desktop ativo com containers Linux.

```bash
npm ci
cp .env.example .env
docker compose up -d --wait
npm run migrate
npm run dev:api
```

Em outro terminal:

```bash
npm run dev:worker
```

A API escuta somente em `127.0.0.1:3000`. PostgreSQL, RabbitMQ e seu painel também estão publicados somente no loopback. Painel RabbitMQ: http://localhost:15672 (`payments` / `payments`). As credenciais são apenas para desenvolvimento local.

Em PowerShell, copie com `Copy-Item .env.example .env`; use `curl.exe` em vez do alias `curl`, ou `Invoke-RestMethod`.

## Exemplo de uso (bash)

Todas as rotas exigem `X-API-Key: local-simulation-only`, ou a chave definida no `.env`.

```bash
curl -s http://localhost:3000/merchants \
  -H 'X-API-Key: local-simulation-only' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Loja Demo"}'
```

Copie o `id` retornado para `merchantId`:

```bash
curl -s http://localhost:3000/payments \
  -H 'X-API-Key: local-simulation-only' \
  -H 'Idempotency-Key: pedido-001' \
  -H 'Content-Type: application/json' \
  -d '{"merchantId":"UUID-DO-MERCHANT","amount":1099,"method":"PIX","scenario":"APPROVED"}'
```

O pagamento nasce `PENDING`; consulte até o worker processar:

```bash
curl -s http://localhost:3000/payments/UUID-DO-PAGAMENTO \
  -H 'X-API-Key: local-simulation-only'

curl -s http://localhost:3000/payments/UUID-DO-PAGAMENTO/refunds \
  -H 'X-API-Key: local-simulation-only' \
  -H 'Idempotency-Key: estorno-001' \
  -H 'Content-Type: application/json' -d '{}'

curl -s http://localhost:3000/merchants/UUID-DO-MERCHANT/balance \
  -H 'X-API-Key: local-simulation-only'
```

Repita a criação com o mesmo payload e chave: retorna o mesmo pagamento. Reutilizar a chave com outro payload retorna `409`. A chave de criação é única por merchant. No estorno, a chave é vinculada ao pagamento; uma chave diferente para um pagamento já estornado retorna `409`. Sem chave, UUID inválido ou campos extras: `400`. Sem autenticação: `401`.

## Rotas

| Método | Rota | Uso |
|---|---|---|
| GET | `/health` | Verifica API e PostgreSQL; não verifica o worker/broker |
| POST | `/merchants` | `{ "name": "Loja Demo" }` |
| POST | `/payments` | Cria pagamento; exige `Idempotency-Key` |
| GET | `/payments/:id` | Consulta status |
| POST | `/payments/:id/refunds` | Estorno integral; corpo `{}` e chave |
| GET | `/payments/:id/audit` | Histórico de ações |
| GET | `/merchants/:id/balance` | Saldo contábil simulado |

## Testes

```bash
npm run check               # TypeScript + testes unitários, sem Docker
npm run test:integration    # exige PostgreSQL e migrations aplicadas
```

O teste de integração verifica concorrência de chaves idempotentes, duplicação de eventos, aprovação, recusa, estorno e invariantes do ledger. Ele acrescenta dados fictícios: use um banco de testes separado via `DATABASE_URL`. Não testa o transporte RabbitMQ de ponta a ponta.

## Operação e limitações

- Falhas de consumo fazem até quatro reenvios pela `payments.retry`, com atraso de aproximadamente cinco segundos; a quinta falha vai para `payments.dead`. Revisão e replay da DLQ ainda são manuais.
- A DLX da fila de retry usa o comportamento padrão do RabbitMQ; não é uma garantia de entrega sem perda em cenários de falha do broker. Para maior robustez, evoluir para quorum queues/dead-lettering at-least-once.
- Uma falha de publicação deixa a outbox pendente para nova tentativa. PostgreSQL precisa estar acessível durante o processamento.
- Se a conexão RabbitMQ cair, reinicie o worker. Não há supervisor automático nesta versão.
- API usa chave global de desenvolvimento, não isolamento multi-tenant. Não exponha à internet: faltam RBAC, rate limiting, TLS e hardening.
- O ledger impede UPDATE/DELETE/TRUNCATE via triggers; usuários privilegiados do banco ainda podem desabilitar as proteções. Não é armazenamento inviolável.
- Nenhum número de cartão, CVV, CPF ou conta bancária é necessário/aceito no payload de pagamento.
- Os volumes persistem dados. `docker compose down -v` **apaga os dados locais**.

## Roadmap sugerido

1. Dashboard e autenticação de usuários com autorização por merchant.
2. Contas internas, split e transferências simuladas, com invariantes contábeis.
3. Provedor simulado independente, timeouts e reconciliação.
4. Webhooks assinados, tentativas e consulta de entregas.
5. Métricas, tracing, testes end-to-end e testes de recuperação de falhas.
