# WJPDM — diretório e cofre de engenharia do WJCAD (G5)

> Nomes na interface (decisão do Johann, 28/10/2026): **GO-OUT** = check-out (retirar para editar) e
> **GO-IN** = check-in (devolver ao cofre, gerando versão). O texto abaixo usa os termos genéricos.

Inspiração funcional: sistema de PDM profissional integrado ao CAD de referência. O fluxo de cofre
é o mesmo: pasta local espelhada, check-out/check-in, cartões de dados, estados e transições,
referências e lista de materiais. Nomes, ícones e telas são nossos; nada é copiado.
O WJPDM é o **diretório do WJCAD**: é por ele que as peças são abertas, salvas, revisadas e
liberadas. Também guarda arquivos das outras faces e arquivos externos.
Servidor: Cloudflare Workers + D1 (metadados) + R2 (arquivos) + Durable Objects (travas e tempo real).
Status de tudo: **G5** salvo indicação.

---

## Cofre único e cópias (28/10/2026)

✅ Todo arquivo dos apps vive no cofre (`src/comum/cofre.ts`). **Salvar grava só no dispositivo**
(banco do app + pasta padrão do dispositivo), em GO-OUT: o primeiro salvar abre "Salvar no cofre"
(pasta, Nova pasta, nome; lembra a última pasta de cada app) e o arquivo fica **só no dispositivo**
(`soLocal`, ⌂ na lista) até o primeiro GO-IN, que publica a versão 1; depois, salvar grava a
**cópia de trabalho** (✎). **GO-IN** cria a versão e **publica no pendrive e no Drive**, que só
recebem o que passou por GO-IN. Desfazer GO-OUT descarta a cópia de trabalho. "Abrir do cofre" em
cada app. WJPDM e WJERP (cópias de segurança) entram direto na pasta da face, sem perguntar.
✅ Aba **Cofre** na lateral direita de cada app de documento: arquivo, pasta, estado, revisão,
versão, GO-OUT; botões GO-OUT / GO-IN (comentário, manter em GO-OUT; salva antes de publicar) /
Desfazer GO-OUT / Salvar; lista **Meus arquivos em GO-OUT** de todos os apps com GO-IN por item ou
dos marcados; número de arquivos em GO-OUT na própria aba.
✅ **Sincronia global a cada abertura** de qualquer app (WJCAD depois do kernel carregar): iguala
dispositivo, pendrive e Drive sem pedir nada; pendrive sem permissão ou Drive com login vencido
(1 h) ficam para o próximo toque (salvar, GO-IN ou **Sincronizar agora** na aba Cofre), com aviso.
✅ **Cópias do cofre** (tela em 📁 / Ferramentas): pendrive (`WJPDM/` na raiz dele), pasta padrão do
dispositivo e, quando configurado, Google Drive. Sincronia (`src/pdm/sincronia.ts`): junta os índices; o
que falta é copiado; mesmo registro alterado em duas cópias: **a alteração mais recente vence** e a
outra vira cópia na lixeira ("(conflito AAAA-MM-DD)"); exclusões e lixeira propagam; lixeira se
esvazia após 30 dias. Salvar seguido (cópia de trabalho ou rascunho nunca publicado trocado) não
é conflito: só uma versão publicada perdida gera a cópia na lixeira. Cada cópia guarda `WJPDM/<pastas>/<arquivo>` (legível em qualquer
computador) + `WJPDM/.wjpdm/indice.json` e `.wjpdm/blobs/` (conteúdo de cada versão).
✅ Google Drive (`src/comum/drive.ts`): "Conectar ao Google Drive" na tela de cópias; cofre em
Meu Drive/WJPDM; acesso de 1 hora renovado ao salvar/sincronizar (toque do usuário).
🟡 Arquivos colocados à mão na pasta do pendrive ainda não
entram no cofre (adicionar pelo WJPDM).

## Estado da v1 (25/10/2026) — `pdm/index.html`, `src/pdm/` (cofre local)

✅ Cofre **neste aparelho** (IndexedDB; funciona sem internet), regras puras testadas em
`scripts/teste-pdm.ts`:
- árvore de pastas, migalhas, pesquisa por nome/código/descrição/material, arrastar arquivos do
  aparelho para a lista, lixeira (restaurar/destruir);
- arquivos com **versões** (cada check-in) e **revisões** (A, B… na liberação; Z → AA);
- **check-out/check-in** com trava por usuário, comentário, "manter check-out", check-in de um
  arquivo do aparelho **ou do documento aberto no WJCAD/WJPlan/WJWrite/WJApresentation/WJCronProject**;
  desfazer check-out (com liberação de administrador);
- **fluxo**: Em trabalho → Em revisão → Liberado (sobe a revisão) → Nova revisão; rejeitar,
  obsoleto, reativar; condições (sem check-out, código e descrição preenchidos); liberado não se
  edita nem se exclui;
- **cartão de dados** (código, descrição, material, projetista, projeto, acabamento, observação,
  item), editável só com check-out;
- visualizar imagens, PDF, texto/CSV/DXF e resumo dos documentos do WJProMaster; **abrir no app**;
- versões (obter qualquer versão, restaurar como versão nova) e histórico de eventos;
- **itens** com numeração por máscara (`12-####`), criar item a partir do cartão, **lista de
  materiais** editável, explodida em todos os níveis (com detecção de ciclo), onde é usado,
  arquivos do item, exportar a lista em CSV;
- usuário e nome do cofre; cópia de segurança completa (`.wjpdm`) e restauração; armazenamento
  persistente.

🟡 Próximos (G5): cofre no servidor compartilhado pela equipe (travas em tempo real), permissões
por grupo, editor de fluxos e de cartões, aprovação com vários aprovadores, referências entre
arquivos (montagens), propriedades lidas da peça do WJCAD (massa, planificado), copiar com
referências, integração com o WJERP.

---

## 0. Conceitos

- **Cofre**: repositório da empresa no servidor (um ou mais por empresa: Engenharia, Ferramentaria…).
- **Visão local do cofre**: cópia de trabalho no aparelho (OPFS/IndexedDB), com a mesma árvore de
  pastas. É ela que permite trabalhar offline e abrir peças instantaneamente.
- **Arquivo** com histórico:
  - **versões** (1, 2, 3…): cada check-in;
  - **revisões** (A, B, C… ou 00, 01…; esquema por tipo de arquivo): marcas formais dadas na
    liberação.
- **Item**: código do produto, objeto compartilhado com o WJERP (seção 4). Um item pode ter vários
  arquivos (peça, DXF, PDF, instrução de trabalho). Um arquivo de peça tem um item principal.
- **Referências** entre arquivos:
  - montagem → peças (quando o WJCAD tiver montagens ⏸);
  - peça → arquivo de configuração/planilha;
  - documento → peça (vista vinculada);
  - lista "contém" e "onde é usado".
- **Variáveis do cofre**: campos (código, descrição, material, projetista, aprovador, data de
  aprovação, revisão…) ligados às **propriedades do arquivo** do WJCAD e das outras faces, nos dois
  sentidos.

## 1. Interface — o explorador do cofre

- Aberto pelo WJProMaster (hub) ou de dentro do WJCAD (Arquivo → Abrir do cofre / painel lateral **Cofre**).
- **Árvore de pastas** à esquerda.
- **Lista de arquivos** no centro. Colunas configuráveis:
  - nome;
  - ícone de estado local: atualizado, desatualizado, só no servidor, com check-out meu/de outro,
    modificado localmente;
  - versão, revisão, estado, check-out por, item, descrição, material, data.
- **Abas inferiores** do arquivo selecionado:
  - **Cartão de dados** (formulário de propriedades);
  - **Visualizar** (3D leve / PDF / imagem);
  - **Versões** (lista com comentário, autor, data; obter, comparar, abrir somente leitura);
  - **Contém** e **Onde é usado** (árvores de referência);
  - **Lista de materiais**;
  - **Histórico** (eventos e transições).
- Barra de comandos: Obter versão mais recente, Obter versão…, Check-out, Check-in, Desfazer
  check-out, Alterar estado ▾, Novo ▾ (pasta, peça a partir de modelo, item), Copiar com
  referências, Mover/Renomear, Pesquisar, Exportar.
- Menu de contexto igual à barra.
- Arrastar arquivos do aparelho para a pasta = adicionar ao cofre (ainda sem check-in até confirmar).
- Celular:
  - pesquisa + visualizar + aprovar/rejeitar transições + comentar;
  - a árvore vira navegação por níveis (migalhas);
  - check-out/edição só no tablet/computador.
- Tablet: completo, com o explorador em tela dividida com o WJCAD.

## 2. Operações de arquivo

### 2.1 Obter
- **Obter versão mais recente**: baixa para a visão local o que estiver desatualizado (arquivo,
  pasta, ou o arquivo **com as referências**).
- **Obter versão…**: escolhe a versão ou revisão (por exemplo, a última liberada) para cada
  referência.
- Ao abrir uma peça no WJCAD a partir do cofre, a versão local é conferida e o usuário é avisado se
  estiver desatualizada.

### 2.2 Check-out / check-in
- **Check-out**: trava exclusiva no servidor (Durable Object) e torna a cópia local editável.
  Arquivos sem check-out abrem **somente leitura** no WJCAD (o título mostra 🔒 e quem tem o arquivo).
- **Check-in**:
  - painel com a lista de arquivos (com referências modificadas marcadas) e comentário obrigatório
    configurável;
  - opção "manter check-out";
  - validações (propriedades obrigatórias, referências faltando);
  - gera versão nova e atualiza as variáveis do cofre a partir das propriedades.
- **Desfazer check-out**: descarta as alterações locais (com confirmação) e libera a trava.
- Trava esquecida: administrador pode liberar, com registro no histórico.
- Offline: só edita o que já está com check-out. Check-in entra na fila ao voltar a rede.

### 2.3 Adicionar, copiar, mover, renomear, excluir
- **Adicionar**: novos arquivos entram como versão 1 no estado inicial do fluxo, com numeração
  automática do nome (opcional, por máscara: `12-####`).
- **Copiar com referências**:
  - copia a peça/estrutura escolhendo quais referências copiar ou reutilizar;
  - renomear (prefixo/sufixo, substituir, nova numeração);
  - pasta de destino;
  - as referências da cópia apontam para as cópias.
- **Mover/Renomear** atualiza as referências de quem usa o arquivo (só com permissão e sem
  check-out de terceiros).
- **Excluir** vai para a lixeira do cofre (recuperar / destruir com permissão). Arquivo liberado ou
  usado por outros não pode ser excluído.

### 2.4 Pesquisa
- Pesquisa rápida (nome, código, descrição) e **formulários de pesquisa** salvos por variável
  (estado, material, projetista, data, item, revisão), texto do conteúdo e geometria simples
  (caixa delimitadora, massa).
- Pesquisas favoritas no painel; resultados com as mesmas ações da lista.

## 3. Cartões de dados

- Formulário por tipo de arquivo (peça, chapa, documento, planilha, DXF, PDF, pasta, item) com
  campos ligados às variáveis do cofre.
- Tipos de campo: texto, número, data, lista, caixa de seleção, usuário, fórmula do motor comum
  (`=WJ.CAD(…;"Massa")`), somente leitura.
- Por configuração do WJCAD: o cartão mostra a guia de configurações.
- Regras:
  - campos obrigatórios por estado;
  - valores padrão (data, usuário);
  - listas vindas do WJERP (materiais, famílias, unidades).
- Editor de cartões (administrador): arrastar campos, abas, condições de visibilidade.
- Cartão de pasta herda valores (cliente, projeto) para os arquivos criados nela.

## 4. Itens e lista de materiais

- **Item**:
  - código (numeração automática por família/máscara, ex.: `12-0034`), descrição, descrição técnica;
  - tipo: produto acabado, semiacabado, peça fabricada, comprado, matéria-prima, consumível, serviço;
  - unidade, família/grupo, material, massa, acabamento/tratamento;
  - propriedades personalizadas;
  - arquivos ligados.
- **Vínculo item ↔ peça do WJCAD**: propriedades do `.wjcad` mapeadas para o item:
  - massa, volume, material, dimensões da caixa;
  - espessura, área do planificado, comprimento de corte e nº de dobras (chapa).
- Item comprado: fabricante, código do fabricante, fornecedores homologados (WJERP).
- **Lista de materiais (EBOM)**:
  - calculada das referências (montagens ⏸) ou montada à mão no item, com quantidade, unidade,
    posição/balão e observação;
  - versões da lista acompanham as versões do arquivo;
  - **onde é usado** em todos os níveis;
  - comparar listas (revisões ou itens);
  - exportar para o WJPlan.
- Transferência ao WJERP: EBOM → estrutura de manufatura (MBOM) com perdas, fantasmas, alternativos,
  consumo de matéria-prima (chapa: área planificada × espessura × densidade × (1 + perda)) e roteiro.
  Detalhes em [erp.md](erp.md).

## 5. Fluxo de trabalho (estados e transições)

- **Editor de fluxos** (administrador): estados e transições desenhados num diagrama.
- **Estado**:
  - nome, cor/ícone;
  - permissões por grupo: ler, check-out, excluir, alterar estado, ver versões;
  - se é "liberado" (bloqueia edição).
- **Transição**:
  - quem pode executar;
  - **condições**: variáveis preenchidas, referências já em estado X, arquivo de desenho anexo,
    sem check-out;
  - **aprovação**: um aprovador, todos, maioria ou N de M, com prazo;
  - **ações**:
    - incrementar revisão;
    - definir variáveis (aprovador, data);
    - **tarefas de conversão**: gerar PDF das vistas, DXF do planificado, STEP, glTF para
      visualizar;
    - notificar pessoas/grupos (e-mail e notificação no WJProMaster);
    - criar ou atualizar o item no WJERP;
    - fechar marco no WJCronProject.
- Fluxo padrão:
  1. **Em trabalho**: o projetista edita.
  2. **Em revisão**: a edição fica travada e o aprovador vê.
  3. **Liberado**: ganha revisão A/B…, gera arquivos de fabricação e atualiza o ERP.
  4. **Em alteração**: volta para Em trabalho, sobre uma cópia da última liberada.
  5. **Obsoleto**: não pode ser usado em listas novas. Há também **Cancelado**.
- **Transições em lote**: alterar o estado de uma estrutura inteira (filhos antes do pai, com
  verificação).
- **Mudança de engenharia**:
  - **solicitação (ECR)** → **ordem (ECO)**;
  - itens afetados, motivo, impacto (estoque, OPs abertas, pedidos);
  - efetividade (data ou lote);
  - disposição do estoque antigo;
  - ao liberar, a estrutura do WJERP recebe a vigência.

## 6. Visualizar, comparar e marcar

- Visualizador leve (`@wj/visualizador-3d`, sem kernel), também no celular:
  - orbitar, vistas padrão;
  - medir (distância, ângulo, raio);
  - corte por plano;
  - explodir ⏸;
  - árvore de recursos/propriedades.
- **Comparar** duas versões/revisões:
  - propriedades lado a lado;
  - geometria com realce do que entrou/saiu (diferença booleana calculada no servidor, ou no WJCAD
    se aberto).
- **Marcações**: anotações 3D/2D (seta, nuvem, texto, foto) ligadas à versão. Viram comentários e
  podem virar tarefa ou solicitação de mudança.

## 7. Administração

- Grupos e usuários (do WJProMaster), permissões por pasta × estado.
- Variáveis, cartões, fluxos, numeração (séries), esquemas de revisão, modelos de arquivo (peça
  WJCAD com propriedades padrão, documento WJWrite padrão).
- Tarefas de conversão (filas, formatos, onde salvar o resultado).
- Cotas de armazenamento, retenção de versões antigas (manter últimas N + todas as revisões),
  backup/exportação completa do cofre.
- Auditoria: quem abriu, baixou, alterou, aprovou.

## 8. Integração com o WJCAD (o que muda no CAD)

- Arquivo → **Abrir do cofre / Salvar no cofre / Check-in / Check-out / Desfazer check-out /
  Obter versão mais recente**.
- Painel lateral **Cofre** dentro do WJCAD (explorador compacto) e a aba **Cartão de dados** nas
  propriedades da peça.
- Título com estado e revisão (`Suporte — Rev. B — Liberado 🔒`); edição bloqueada sem check-out
  ou quando liberada.
- Salvar uma peça nova no cofre pede a pasta e preenche o cartão (numeração automática).
- Propriedades do arquivo ↔ variáveis do cofre sincronizadas a cada check-in.

## 9. Atalhos (computador)

- Ctrl+Shift+G obter versão mais recente · Ctrl+Shift+O check-out · Ctrl+Shift+I check-in.
- F3 pesquisar · F5 atualizar a lista.
