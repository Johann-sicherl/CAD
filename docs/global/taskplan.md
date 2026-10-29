# WJTaskPlan — tarefas em pastas, escritas à mão

Face simples do WJProMaster, pedida pelo Johann em 29/10/2026. Página `tarefas/`, código em
`src/tarefas/`, regras puras em `src/tarefas/regras.ts` (testes em `scripts/teste-tarefas.ts`).

## Funções

| Função | Como funciona | Estado |
|---|---|---|
| Árvore de pastas (lateral esquerda) | Pastas e subpastas sem limite de níveis. **+** cria na raiz; **⋯** (ou botão direito) da pasta: nova tarefa aqui, nova subpasta, renomear (ou toque duplo), mover para…, subir/descer, tirar da pasta, excluir. **Arrastar pela alça ⠿** (caneta, dedo ou mouse): no meio de outra pasta entra nela; na borda de cima/baixo fica antes/depois; em "Todas as tarefas" vai para a raiz. Mover para dentro de uma subpasta dela mesma é recusado. | ✅ |
| Nova tarefa com a caneta | Botão **Nova tarefa** (ou tecla N) abre a área de escrita; a cada pausa da caneta o texto aparece transcrito no campo de cima, com alternativas para tocar. **Continuar escrevendo** guarda o texto e limpa a área; **Desfazer traço**. O campo aceita digitação. **OK** cria a tarefa. Com a caneta em uso, o toque da palma na área é ignorado. | ✅ |
| Estados | Na frente de cada tarefa, seletor de estado. De fábrica: Novo, Em execução, Concluído. Editáveis em Configurações (nome, cor, tipo, ordem, excluir passando as tarefas para outro estado). Tipo: **Início** (tarefa nova entra no primeiro), **Em andamento**, **Concluído**; é preciso ter ao menos um Início e um Concluído. | ✅ |
| Datas automáticas | Criação com data e hora; cada troca de estado entra no histórico com data e hora (⋯ → Histórico de estados: tempo em cada estado e tempo de atendimento). | ✅ |
| Prazo de conclusão | Opcional: caixa "Prazo de conclusão" liga o campo de data. Selo na lista: atrasada (vermelho), perto do prazo (amarelo). | ✅ |
| Alerta ao abrir | Janela com as tarefas não concluídas atrasadas ou com prazo dentro da antecedência escolhida; tocar numa abre a tarefa. Pode ser desligada. | ✅ |
| Painel | Pela pasta escolhida (com ou sem subpastas) ou todas: total, quantidade por estado, atrasadas, vencendo; **tempo de atendimento** (criação → conclusão: média, mediana, mín., máx.), tempo de execução (início da execução → conclusão), concluídas em 7/30 dias; tabela por pasta. | ✅ |
| Configurações | Dias de antecedência do alerta; mostrar alerta ao abrir; estados; reconhecimento online; cópias; baixar tabela CSV. | ✅ |

## Escrita à mão (reconhecimento)

`src/tarefas/escrita.ts`. Ordem de uso:

1. **Reconhecedor do próprio navegador** (Handwriting Recognition API), quando o aparelho tem: funciona
   sem internet. Hoje o Chrome só oferece isso em alguns sistemas (ChromeOS); no Android ainda não.
2. **Serviço online de escrita à mão do Google** (os traços vão para o Google e o texto volta). Precisa
   de internet; pode ser desligado em Configurações. É um serviço público sem contrato: se o Google
   mudar ou desligar, o app avisa e o campo de texto continua valendo.
3. Sem nenhum dos dois: escrever direto no campo com a **S Pen para texto** do Galaxy Tab (recurso do
   próprio tablet, sem internet) ou digitar.

## Dados e cópias

Mesma lógica do cofre do WJPDM, numa **pasta irmã** dele em cada cópia:

```
<raiz do pendrive>/WJPDM/        ← cofre
<raiz do pendrive>/WJTaskPlan/tarefas.json   ← dados (sincronia)
<raiz do pendrive>/WJTaskPlan/tarefas.csv    ← tabela legível (abre no WJPlan)
```

O mesmo vale para a pasta padrão do dispositivo e para o Google Drive (Meu Drive/WJTaskPlan). As raízes
e o acesso ao Google são os do cofre (📁 Cópias do cofre). No aparelho: IndexedDB `wjtaskplan`.

Sincronia (`src/tarefas/copias.ts`): grava no aparelho a cada mudança e iguala as cópias 2,5 s depois,
ao abrir o app e em **Sincronizar agora**. Mescla por registro (pasta, tarefa, estado, configuração):
**a alteração mais recente vence**; exclusões viajam como lista de exclusões (30 dias) e vencem
alterações anteriores a elas. Tarefas de uma pasta excluída em outro aparelho vão para a primeira pasta
da raiz; movimentos cruzados de pastas que formariam ciclo sobem para a raiz.

## Próximos passos possíveis

- Ordenar tarefas à mão (arrastar na lista) e arrastar tarefas para pastas.
- Lembrete do sistema (notificação) sem abrir o app — depende do servidor (G5).
- Ligar tarefas ao WJCronProject e a arquivos do cofre.
