# ADR 001 — Outbox transacional e processamento idempotente

- Status: adotado na implementação inicial
- Escopo: simulador de pagamentos

## Contexto

A API grava pagamentos no PostgreSQL, enquanto o trabalho assíncrono é distribuído pelo RabbitMQ. Não há transação única que confirme atomicamente a escrita no banco e a publicação no broker.

Publicar antes do commit pode gerar um evento sem pagamento persistido. Publicar depois do commit sem outbox pode perder o evento caso o processo encerre entre as duas operações.

## Decisão

1. Persistir o pagamento e seu evento de outbox na mesma transação.
2. Selecionar eventos pendentes com `FOR UPDATE SKIP LOCKED`.
3. Publicar mensagens persistentes e aguardar publisher confirms.
4. Marcar o evento como publicado somente após a confirmação.
5. Deduplicar o consumo pela chave primária de `processed_events`.
6. Confirmar deduplicação, estado, lançamentos contábeis e auditoria na mesma transação; depois enviar o ack ao broker.

O consumidor valida o envelope e confirma que ele corresponde a um evento existente na outbox. O payload do broker não determina valores financeiros.

## Consequências

- Entrega at-least-once: duplicatas são esperadas.
- Queda após publicação e antes da marcação pode republicar o mesmo evento.
- Queda após commit de processamento e antes do ack causa reentrega sem repetir os efeitos.
- A transação de publicação mantém locks durante chamadas ao broker; lotes pequenos limitam, mas não eliminam, esse custo.
- Outbox e deduplicação crescem continuamente; política de retenção ainda precisa ser definida sem comprometer replay e auditoria.
- A decisão não resolve efeitos externos de gateways reais. Um futuro provedor independente exigirá idempotência própria, tratamento de resultados incertos e reconciliação.

## Alternativas

- Escrita dupla sem outbox: simples, mas pode perder eventos.
- CDC: alternativa futura, com maior custo operacional.
- Transação distribuída: complexidade desnecessária para este simulador.
