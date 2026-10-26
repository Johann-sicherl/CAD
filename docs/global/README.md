# WJProMaster — visão do ecossistema

Ecossistema próprio e integrado de software de engenharia e gestão, do Johann. **WJProMaster** é o
nome oficial do conjunto (o "maestro" que reúne tudo); cada face tem o seu nome WJ. Todas as faces rodam no **celular, tablet e notebook/computador**
(navegador Chrome/Edge e PWA instalável). Elas compartilham núcleo de interface, dados, fórmulas
e identidade de objetos.

| Face | O que é | Inspiração funcional | Arquivo / dado | Especificação |
|---|---|---|---|---|
| **WJProMaster** | hub: início, arquivos recentes, busca, notificações, conta | — | — | este arquivo (§5) |
| **WJCAD** | CAD paramétrico (antigo JLSCAD) | CAD paramétrico profissional | `.wjcad` (abre `.jlscad`/`.cadt`) | [cad.md](cad.md) + `docs/funcional/` |
| **WJPDM** | diretório/cofre do WJCAD: versões, revisões, fluxos, itens, lista de materiais | PDM integrado ao CAD de referência | cofre no servidor | [pdm.md](pdm.md) |
| **WJPlan** | planilhas com fórmulas avançadas | planilha eletrônica profissional | `.wjpl` | [planilha.md](planilha.md) |
| **WJWord** | documentos com propriedades avançadas | processador de texto profissional | `.wjdoc` | [documentos.md](documentos.md) |
| **WJApresentation** | apresentações | software de apresentações profissional | `.wjapn` | [apresentacoes.md](apresentacoes.md) |
| **WJCronProject** | cronogramas e projetos | gerenciador de projetos com Gantt | `.wjcron` | [cronograma.md](cronograma.md) |
| **WJERP** | gestão empresarial SaaS ligada ao WJPDM/WJCAD | ERP brasileiro de mercado | banco no servidor | [erp.md](erp.md) |
| Integrações entre as faces | — | — | [integracoes.md](integracoes.md) |
| Prompt-mestre para desenvolver | — | — | [prompt-mestre.md](prompt-mestre.md) |

Legenda de status (igual à do CAD): ✅ existe · 🟡 parcial · **G0…G8** fase do roteiro global ·
⏸ registrado, fora do escopo atual.

---

## 1. Princípios (valem para todas as faces)

1. **Inspiração, nunca cópia.** (Atenção ao nome **WJWord**: "Word" é marca registrada de
   processador de texto — risco de conflito de marca; ver §6.) O fluxo e o comportamento podem ser parecidos com os softwares de
   referência, mas **não** se copia:
   - código, ícones, logotipos, cores de marca, textos de ajuda ou telas;
   - nomes registrados (ex.: "Excel", "Word", "PowerPoint", "Project", "Protheus", "SmartArt",
     "Power Query", "Morph", "IntelliSense", "SOLIDWORKS").
   Os nomes da UI são nossos, em português. Os ícones são SVG próprios.
2. **Formatos.**
   - Os formatos nativos são nossos (JSON versionado; ZIP quando houver anexos).
   - **Importar e exportar formatos abertos é permitido**, porque são normas públicas: OOXML
     ECMA-376 (.xlsx/.docx/.pptx), ODF ISO 26300 (.ods/.odt/.odp), CSV, PDF, MSPDI XML
     (cronograma), DXF, STEP e STL.
   - Formatos binários proprietários fechados (.mpp, .sldprt…) e engenharia reversa: **não**.
3. **Um operador, três aparelhos.**
   - O perfil de dispositivo (Celular / Tablet / Computador) é o mesmo do CAD, escolhido uma vez
     e válido em todas as faces (classe `disp-*` no `body`).
   - Cada função é especificada para os três perfis.
4. **Local primeiro (local-first).**
   - Tudo funciona offline com os dados no aparelho (IndexedDB/OPFS) e sincroniza quando há rede.
   - A exceção é o ERP, que é multiusuário por natureza: offline ele só lê o cache e enfileira
     lançamentos.
5. **Tudo é objeto com endereço.** Cada coisa (célula, intervalo, parágrafo, slide, tarefa, item,
   peça, cota, pedido…) tem um **URI global** `wj://<face>/<id-do-arquivo-ou-tabela>/<id-interno>`.
   Vínculos entre faces usam esse URI, nunca cópia de valor.
6. **Um motor de fórmulas só** (`@wj/formulas`). A mesma linguagem serve para:
   - a Planilha;
   - as equações do CAD;
   - os campos calculados de Documentos e Apresentações;
   - os campos personalizados do Cronograma;
   - as regras, gatilhos e relatórios do ERP.
7. **Comandos, atalhos e painéis seguem o mesmo padrão em todas as faces:**
   - abas de comando com ícones;
   - painel de propriedades/comando à esquerda com ✓/✕;
   - barra de contexto ao selecionar;
   - menu de contexto no botão direito ou toque longo;
   - barra de status embaixo;
   - Ctrl+Z/Y/S/C/V/X/F/P iguais em todas.
8. **Tema claro** por padrão (o escuro fica opcional, depois). Português (Brasil). Unidades SI
   (mm no CAD). Moeda R$ e padrões fiscais brasileiros no ERP.
9. **Qualidade:**
   - lógica pura testável em Node, sem DOM, para todo motor (fórmulas, paginação, CPM, MRP, custos);
   - antes de cada commit: `pnpm check && pnpm teste && pnpm build`;
   - dependência nova só com justificativa, de projeto conhecido e com revisão do lockfile.

## 2. Arquitetura proposta (monorepo `WJProMaster`)

```
WJProMaster/
├─ apps/
│  ├─ inicio/          WJProMaster (hub): arquivos recentes, busca global, notificações, abrir qualquer face
│  ├─ cad/             WJCAD (o app atual, movido de src/)
│  ├─ planilha/        WJPlan
│  ├─ documentos/      WJWord
│  ├─ apresentacoes/   WJApresentation
│  ├─ cronograma/      WJCronProject
│  ├─ pdm/             WJPDM (explorador do cofre)
│  └─ erp/             WJERP
├─ packages/
│  ├─ nucleo/          casca da UI: abas de comando, painel ✓/✕, árvore/lista lateral, menus,
│  │                   barra de status, perfis de dispositivo, atalhos, gaveta, lupa, toque/caneta
│  ├─ icones/          SVG próprios de todas as faces
│  ├─ formulas/        analisador, avaliador, grafo de dependências, ~450 funções (Node-testável)
│  ├─ texto-rico/      modelo de texto (parágrafos, estilos, runs), editor, medição e quebra
│  ├─ paginacao/       motor de layout de páginas (Documentos, impressão da Planilha, PDF)
│  ├─ graficos/        gráficos (coluna, linha, pizza, dispersão, Gantt…) em SVG/Canvas
│  ├─ dados/           armazenamento local, versões, sincronização (CRDT), URIs, vínculos
│  ├─ arquivos/        formatos nativos + importadores/exportadores (xlsx, docx, pptx, pdf, csv, mspdi)
│  ├─ visualizador-3d/ visualizador leve de peças (para PDM, Documentos, Apresentações)
│  └─ ui-testes/       utilitários de teste em navegador (Playwright)
└─ servidor/           API (Cloudflare Workers): contas, empresas, permissões, ERP, PDM, sync
```

- **Um PWA só** ("WJProMaster"), com rotas por face (`/cad`, `/planilha`…).
  - Cache offline único; cada face é carregada sob demanda. O kernel do CAD e os motores pesados
    não entram nas outras faces.
  - Cabeçalhos COOP/COEP continuam valendo (exigência do kernel do CAD).
- **Servidor** (a partir da G5):
  - Cloudflare Workers + D1 (SQLite por empresa/tenant) para o ERP/PDM;
  - R2 para arquivos (cofre do PDM, anexos);
  - Durable Objects para colaboração em tempo real e travas de check-out.
  - Mantém a hospedagem atual (Cloudflare Pages). Se o volume do ERP pedir, avaliar Postgres
    gerenciado; essa decisão é do Johann.
- **Colaboração**: CRDT (Yjs, MIT, projeto conhecido) para WJWord, WJPlan, WJApresentation e
  WJCronProject. O ERP é transacional no servidor e não usa CRDT.
- **Linguagem**: TypeScript em tudo (cliente, servidor, motores). DOM puro como hoje. Um framework
  de UI só entra com justificativa (avaliar quando a Planilha/ERP crescer; Lit ou Preact seriam
  os candidatos leves).
- **Gerenciador de pacotes**: pnpm workspaces (regras de segurança atuais mantidas).

## 3. Dispositivos — regras comuns

| Aspecto | Celular | Tablet | Computador |
|---|---|---|---|
| Comandos | ícones sem texto; abas roláveis; "mais ⋯" | ícones com texto, alvos ≥ 44 px | faixa compacta, dicas no foco |
| Painéis laterais | gaveta sobre o conteúdo | fixos e recolhíveis | fixos, redimensionáveis |
| Entrada | dedo (toque longo = menu) | caneta + dedo, lupa de precisão | mouse (direito = menu) + teclado |
| Teclado | teclado virtual próprio por face (fórmulas, numérico) | idem + físico opcional | atalhos completos |
| Seleção | alças grandes de arrasto | alças + caneta | clique, Shift/Ctrl |
| Edição pesada | permitida, com assistentes | completa | completa |
| Múltiplas janelas | não | tela dividida do Android | várias abas/janelas e 2º monitor (apresentador) |

## 4. Roteiro global (uma fase por vez, cada uma utilizável nos três aparelhos)

| Fase | Entrega | Por que nessa ordem |
|---|---|---|
| **G0** Fundação | monorepo, `nucleo`, `icones`, `dados` local, hub WJProMaster, PWA único com rotas; CAD movido para `apps/cad` sem perder nada | base de tudo |
| **G1** WJCAD | termina a Fase 4 (chapa) e a Fase 5 do CAD; propriedades personalizadas da peça (alimentam o WJPDM) | face que já existe |
| **G2** WJPlan | `formulas` completo + planilha (grade, formatos, gráficos, tabelas, dinâmica, xlsx/csv) | o motor de fórmulas é usado por todas as outras faces |
| **G3** WJWord | `texto-rico` + `paginacao` + documentos (estilos, sumário, campos, controle de alterações, docx/pdf) | base de texto para Apresentações e relatórios do ERP |
| **G4** WJApresentation | slides, mestres, animações, apresentador, pptx/pdf | reaproveita texto rico e gráficos |
| **G5** Servidor + WJPDM | contas, empresas, permissões, sync/colaboração, cofre do WJPDM, itens, revisões, estrutura, fluxos | liga o CAD ao mundo do ERP |
| **G6** WJCronProject | EAP, CPM, recursos, linhas de base, valor agregado, MSPDI | usa servidor (recursos compartilhados) e fórmulas |
| **G7** WJERP (núcleo) | cadastros, estoque/custos, compras, vendas, PCP/MRP, financeiro, CRM simples | usa PDM (estrutura) e Cronograma (capacidade/projetos) |
| **G8** WJERP fiscal e contábil | NF-e/NFS-e (via provedor homologado), SPED, contabilidade, conciliação bancária, boletos/PIX | exige conformidade legal; por último |

A ordem pode mudar por decisão do Johann (por exemplo, antecipar o WJPDM se o uso no trabalho pedir).

## 5. Itens comuns a todas as faces (especificação)

### 5.1 Início (hub) — G0 (🟡 adiantado: página inicial com uma caixa por software ✅, 25/10/2026)
- Recentes de todas as faces (miniatura, face, local, data), fixados, busca global.
- **Novo** → escolher a face e o modelo (em branco, modelos próprios, modelos da empresa).
- **Abrir**: arquivo do aparelho, nuvem do WJProMaster (G5), importar formato aberto.
- Notificações: comentários, menções, aprovações pendentes (PDM/ERP), tarefas atrasadas.
- Perfil de dispositivo, idioma, unidades, tema, conta.

### 5.2 Arquivo e versões — G0/G5
- Salvar local (autosave contínuo), salvar como, exportar, imprimir/PDF.
- Histórico de versões com nome ("Versão enviada ao cliente"), comparar e restaurar.
- Propriedades do arquivo: título, autor, empresa, palavras-chave e **propriedades personalizadas**
  (nome, tipo, valor ou fórmula). Mesma janela em todas as faces.
- Proteção: senha de abertura (criptografia local AES-GCM) e bloqueio de edição por área.

### 5.3 Colaboração — G5
- Coautoria em tempo real (cursores coloridos com nome), presença.
- Comentários com menções (@pessoa), respostas, resolver; tarefas a partir de comentários
  (viram tarefa no Cronograma).
- Compartilhar: pessoas e grupos da empresa, link com papel (ler / comentar / editar), validade.

### 5.4 Área de transferência rica — G2+
Copiar de uma face e colar em outra mantém estrutura e **oferece vínculo**:
- intervalo da planilha → tabela no Documento/slide (vinculada ou estática);
- gráfico → imagem vetorial vinculada;
- vista do CAD → imagem vinculada à peça e revisão.

### 5.5 Busca e "Usado em" — G5
- Busca global por texto, código de item, propriedades e conteúdo.
- Painel **Usado em**: todo objeto mostra onde é referenciado (ex.: item do ERP → peças, estruturas,
  documentos, apresentações, tarefas).

### 5.6 Assistente (IA) — ⏸ (decisão futura)
Comando por linguagem natural em todas as faces (gerar fórmula, resumir documento, montar slides,
sugerir cronograma). Só entra se o Johann decidir, com chave/API configurável.

## 6. Nomes — observação de marca

Os nomes WJ são do Johann (decisão de 24/10/2026). Antes de publicar ou registrar, vale uma busca
no INPI: **WJWord** junta o prefixo a "Word", marca registrada de processador de texto na mesma
classe de software, e é o nome com mais risco. Alternativas sem esse risco: WJDoc, WJTexto, WJWriter.
"Project" (em WJCronProject) é palavra genérica, risco menor. Trocar o nome depois custa pouco
(está concentrado na UI e nos docs); a extensão `.wjdoc` não depende dele.
