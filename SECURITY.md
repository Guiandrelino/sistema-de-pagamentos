# Segurança

## Escopo

Este projeto é um simulador para desenvolvimento local, não um processador de pagamentos reais. A chave global de API não oferece isolamento entre merchants. Não publique a API na internet nem envie informações financeiras ou pessoais reais.

## Reportar problemas

Não inclua credenciais ou dados pessoais em issues públicas. Se o repositório disponibilizar a opção **Report a vulnerability**, utilize-a para comunicação privada. Caso contrário, combine um canal privado com o mantenedor antes de enviar detalhes sensíveis.

Não há SLA de atendimento nem versões com suporte garantido neste estágio.

## Checklist antes de expor qualquer ambiente

- Implementar autenticação de usuários e autorização por merchant.
- Substituir credenciais locais e aplicar privilégios mínimos no banco.
- Adicionar TLS, limites de requisição e gerenciamento seguro de segredos.
- Revisar acesso ao RabbitMQ, PostgreSQL e suas interfaces administrativas.
- Implementar observabilidade sem registrar segredos.
- Validar recuperação de falhas e comportamento das filas.

As credenciais de `.env.example` e `docker-compose.yml` são públicas e destinadas somente ao ambiente local isolado.
