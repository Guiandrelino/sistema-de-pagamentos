# Como contribuir

## Preparação

1. Use Node.js 22+ e execute `npm ci`.
2. Copie `.env.example` para `.env`.
3. Inicie Docker Desktop e execute `docker compose up -d --wait`.
4. Execute `npm run migrate`.

## Fluxo de trabalho

- Crie uma branch a partir de `main` para cada alteração.
- Faça commits pequenos que representem mudanças reais e verificáveis.
- Não versione `.env`, dados pessoais ou credenciais de serviços externos.
- Mantenha todas as operações exclusivamente simuladas.
- Explique no pull request a motivação, as mudanças e os testes executados.

## Validação

```bash
npm run check
npm run test:integration
```

Os testes de integração gravam dados fictícios. Use um banco separado, com `DATABASE_URL` apontando para ele, e aplique as migrations antes dos testes. O CI cria um PostgreSQL temporário para essa finalidade.

Se Docker não estiver disponível, informe que os testes de integração não foram executados; não os declare aprovados.

## Invariantes a preservar

- Valores em centavos inteiros; nunca usar ponto flutuante para cálculos financeiros.
- Chaves idempotentes não podem produzir cobranças duplicadas.
- Estado, ledger, deduplicação e auditoria devem ser confirmados na mesma transação de processamento.
- Eventos de saída devem ser gravados na mesma transação que a operação de origem.
- Ledger append-only e balanceado; correções são lançamentos compensatórios.
- Nunca receber números de cartão, CVV ou dados bancários reais.

## Alterações de banco

Não edite migrations já aplicadas para modificar um ambiente existente. O runner atual aplica somente `001_initial.sql`; antes de adicionar novas versões, evolua o runner e teste atualização e instalação limpa.
