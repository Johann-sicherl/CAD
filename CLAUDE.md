# WJProMaster — contexto para o Claude

> **Ecossistema WJProMaster** (nome oficial do conjunto, definido pelo Johann). Faces:
> **WJCAD** (este app, antigo JLSCAD), **WJPDM** (diretório/cofre do WJCAD), **WJPlan**
> (planilhas), **WJWord** (documentos), **WJApresentation** (apresentações), **WJCronProject**
> (cronogramas) e **WJERP** (ERP SaaS ligado ao WJPDM/WJCAD). Tudo roda no **celular, tablet e
> notebook/computador**. Visão, arquitetura (monorepo), roteiro **G0–G8** e especificação de cada
> face estão em **`docs/global/`**; o prompt de trabalho está em `docs/global/prompt-mestre.md`.
> Até a fase G0 (monorepo), tudo fica neste repositório: o WJCAD (descrito abaixo) e as primeiras
> versões locais das outras faces (seção "Outras faces"). As regras de inspiração sem
> cópia valem para todas as faces: nomes registrados de terceiros ficam proibidos na UI;
> importar e exportar formatos abertos é permitido. Os nomes das faces são decisão do Johann; o
> risco de marca de "WJWord" está anotado em `docs/global/README.md` §6.

## Regras 001 (definidas pelo Johann, 26/10/2026 — valem sempre)

1. **Postura de otimização e melhor experiência de uso (UX):** propor o caminho mais simples,
   rápido e leve para o usuário e para o código.
2. **Discordar quando fizer sentido:** se um pedido não tiver lógica operacional ou impactar
   muito o projeto (desempenho, arquitetura, manutenção), dizer isso claramente, explicar o
   motivo e propor uma alternativa antes de implementar.
3. **Perguntar quando houver dúvida** real de requisito, em vez de supor.
4. **Cautela e precisão:** validar cada mudança (testes, build, verificação no navegador quando
   for interface) e relatar o resultado com fidelidade.
5. **Eficiência e desempenho** em tudo: código enxuto, sem trabalho desnecessário na thread da UI,
   sem dependências supérfluas.
6. **Publicação até o fim, sem trabalho manual do Johann:** depois de `pnpm check && pnpm teste &&
   pnpm build`, fazer commit, push, abrir o PR para `main`, acompanhar o CI, corrigir o que falhar
   e **fazer o merge** quando estiver verde (isso publica no GitHub Pages e no Cloudflare Pages).
   Ele não deve precisar entrar no GitHub nem no Cloudflare. Só parar para perguntar se algo
   exigir decisão dele ou acesso que a sessão não tem.

Responda sempre em **português (Brasil)**. O dono do projeto é o Johann, engenheiro mecânico
que usa CAD paramétrico profissionalmente; trate-o como usuário avançado de CAD.
Ele prefere receber **arquivos/blocos de código completos** após cada mudança, não diffs parciais.

## Objetivo

CAD paramétrico **próprio e simplificado** para rodar em **tablet Android** (navegador Chrome / PWA).
O fluxo de trabalho de CADs paramétricos comerciais serve de **inspiração funcional**
(esboço → feature → árvore de histórico), mas **nada é copiado**:

- Proibido: código, ícones, logos, cores de marca, nomes registrados (ex.: "FeatureManager",
  "CommandManager", "SOLIDWORKS"), formatos proprietários (.sldprt/.sldasm) e engenharia reversa.
- Permitido: conceitos genéricos de CAD (abas de comando, árvore de features, planos de referência,
  tríade de eixos, cotas e relações de esboço, chapa metálica com fator K).
- Ícones são desenhados por nós (SVG próprio). Nomes da UI são nossos, em português.
- Não versionar arquivos de instalação nem arquivos de terceiros.

## Stack atual (v0.1, já funcionando)

- Vite + TypeScript, sem framework de UI (DOM puro)
- Kernel B-Rep: OpenCascade via `replicad` + `replicad-opencascadejs`, rodando em Web Worker
  (`src/kernel/worker.ts`); lógica pura em `src/kernel/regenerar.ts` (testável em Node)
- Esboço (`src/esboco/`): solver PlaneGCS via `@salusoft89/planegcs` (WASM, LGPL) na thread da UI
  (resposta imediata ao arrastar); geometria/operações puras e testadas em `scripts/teste-esboco.ts`
- Visualização: Three.js (`src/viewport.ts`), **Y para cima** (Frontal = XY, Superior = XZ, Lateral = YZ;
  isométrica de (1, 1, 1)), render só quando algo muda. Arquivos até a versão 2 (Z para cima) são
  migrados ao abrir (`validarDocumento`)
- Modelo: lista de features serializada em JSON (`.wjcad`; abre `.jlscad` e `.cadt` antigos), em `src/model.ts`
- **Várias páginas** (Vite multi-page): `index.html` = **início do WJProMaster** (caixas de cada software,
  `src/inicio/`, leve: sem Three.js nem kernel), `cad/index.html` = **WJCAD** (`src/main.ts`) e uma página
  por face (seção "Outras faces"). O logo de cada app volta ao início. Em desenvolvimento: `/` é o início,
  `/cad/` é o WJCAD. Página nova: entrada em `vite.config.ts` (`rollupOptions.input`), em `PAGINAS` do
  `public/sw.js` e caixa em `src/inicio/inicio.ts`.
- PWA (manifest + `public/sw.js`). Hospedagem principal: **Cloudflare Pages** (site na raiz, cabeçalhos
  COOP/COEP em `public/_headers` → `crossOriginIsolated`, requisito do kernel com várias threads).
  O GitHub Actions (`.github/workflows/deploy.yml`) roda check/teste/build e publica também no GitHub Pages.
- Unidade: **mm** (sistema MMGS)

Gerenciador de pacotes: **pnpm** (não usar npm; segurança em `pnpm-workspace.yaml`:
scripts de instalação bloqueados exceto `onlyBuiltDependencies`, `minimumReleaseAge` de 3 dias).
Nova dependência só com justificativa, de projeto conhecido, e revisando o `pnpm-lock.yaml`.

Comandos: `pnpm dev` · `pnpm check` (tsc) · `pnpm teste` (kernel em Node) · `pnpm build`.
Antes de cada commit: `pnpm check && pnpm teste && pnpm build` devem passar.

## Outras faces (v1 locais, 25/10/2026)

Casca comum em `src/comum/` (`casca.ts`: barra superior, faixa de comandos por abas, status,
janelas, menus, desfazer por fotografias, autosave; `icones.ts`; `armazem.ts` = IndexedDB).
Motores puros testados em Node (`pnpm teste`). Estado detalhado no fim de cada `docs/global/<face>.md`.

| Face | Página | Código | Motor testado | Arquivo / dados |
|---|---|---|---|---|
| WJPlan | `planilha/` | `src/planilha/` | `src/formulas/` (`teste-formulas.ts`) | `.wjpl`, autosave `wjpl:documento` |
| WJWord | `documento/` | `src/documento/` | — | `.wjdoc`, autosave `wjdoc:documento` |
| WJApresentation | `apresentacao/` | `src/apresentacao/` | — | `.wjapn`, autosave `wjapn:documento` |
| WJCronProject | `cronograma/` | `src/cronograma/` | `src/agenda/` (`teste-agenda.ts`) | `.wjcron`, XML MSPDI, autosave `wjcron:documento` |
| WJPDM | `pdm/` | `src/pdm/` | `src/pdm/regras.ts` (`teste-pdm.ts`) | IndexedDB `wjpdm`, cópia `.wjpdm` |
| WJERP | `erp/` | `src/erp/` | `src/erp/regras.ts` (`teste-erp.ts`) | IndexedDB `wjerp`, cópia `.wjerp` |

Integrações já feitas: o WJPDM abre arquivos nos apps (grava o autosave do app; o WJCAD abre direto
com `cad/#abrir-autosave`) e faz check-in do documento aberto num app; o WJERP importa itens e
listas de materiais do cofre do WJPDM. Tudo local no aparelho até o servidor (G5/G7).

## Decisões de produto (definidas pelo Johann)

- **Tema claro** (fundo claro no viewport e painéis). Vista sempre em **projeção ortográfica**
  (sem perspectiva/ponto de fuga).
- **Início limpo:** o app abre sem documento (só Novo/Abrir e recentes); **Novo** abre a janela de
  escolha do ambiente (por enquanto só **Peça**).
- **Nome:** **WJCAD** (face do WJProMaster; antes JLSCAD); arquivo de peça **`.wjcad`** (abre também
  `.jlscad` e `.cadt` dos nomes antigos). Chaves internas (`jlscad:` no localStorage, cache `jlscad-`)
  ficam como estão para não perder o autosave e as preferências de quem já usa.
- **Perfil de dispositivo** escolhido na janela inicial (Celular / Tablet / Computador; trocar em
  Ferramentas → Dispositivo): cada perfil mostra só as adaptações do seu operador. Celular: ícones
  sem texto, árvore/painéis em gaveta, dedo desenha. Tablet: caneta + dedo, alvos ≥ 44 px, lupa.
  Computador: botões compactos, mouse e atalhos. Classe `disp-*` no `body`.
- **Sem gestos de mouse/caneta** (guia radial com botão direito + arrastar): o Johann não quer.
- **Entrada:** caneta (S Pen) **e** dedo. Caneta desenha no esboço; dedo navega (1 dedo orbita,
  2 dedos zoom/pan). Sem caneta, o dedo também esboça, com snaps maiores e lupa de precisão.
- **Também precisa funcionar no computador** (Chrome/Edge com mouse e teclado), com o mouse dos CADs
  profissionais: esquerdo seleciona/desenha, **meio gira** (Ctrl + meio arrasta), roda aproxima no
  cursor, **direito abre o menu de contexto**. Atalhos: Ctrl+1…8 vistas, Espaço orientação, F
  enquadrar, S barra de atalhos, Ctrl+B reconstruir, Enter/Esc OK/Cancelar, Ctrl+Z/Y/S; no esboço
  L, R, C, A, S, P, T, D, O, M, V, Delete.
- **Interação (fluxo de CAD profissional):** selecionar faces/arestas no modelo mostra a barra de
  contexto; comandos abrem o **painel de comando à esquerda** (no lugar da árvore) com ✓/✕ e o
  **canto de confirmação** no viewport; campos rosa recebem a geometria tocada; esboços consumidos
  ficam aninhados no recurso; barra de retrocesso na árvore.
- **Só quatro áreas de comando:** **Features**, **Sketch**, **Sheet Metal** e **Avaliar**
  (medir, propriedades de massa, vista de seção, análises). Nada de superfícies, soldas, moldes,
  simulação etc.
- **Fluxo e comportamento o mais próximos possível do SOLIDWORKS** (referência profissional do
  Johann): mesmos painéis de comando, campos, opções, condições finais, mouse e atalhos.
  Continua proibido copiar ícones, cores da marca, logotipos, textos e nomes registrados.
  A especificação campo a campo de cada comando está em **`docs/funcional/`** — consultar antes de
  implementar qualquer comando e atualizar o status (✅/🟡/fase) ao entregar.
  O Johann forneceu o guia introdutório oficial do CAD de referência (PDF no Drive dele, **não
  versionar**); a comparação e as lacunas priorizadas estão em `docs/funcional/referencia-introducao.md`
  — usar como base para os próximos pedidos.
- Layout de referência (genérico de CAD): barra superior com menus/ações rápidas → linha de ícones
  da aba ativa → abas Features / Sketch / Sheet Metal / Avaliar; árvore à esquerda com planos Frontal,
  Superior, Lateral, Origem e features; barra de vistas flutuante no topo do viewport;
  tríade de eixos no canto inferior esquerdo; barra de status embaixo (unidades, estado).
  Tudo adaptado a toque (alvos ≥ 44 px).

## Roteiro (uma fase por vez, cada uma utilizável no tablet)

1. **Interface nova** — tema claro; abas Features / Sketch / Sheet Metal com ícones próprios;
   árvore com planos e origem; barra de vistas; tríade; barra de status.
2. **Sketch real** — linha, retângulo, círculo, arco, rasgo, polígono, spline, aparar, offset,
   espelhar; cotas e relações (coincidente, horizontal, vertical, paralelo, perpendicular,
   tangente, igual, concêntrico, fixo) com solver **PlaneGCS** (WASM, LGPL); esboçar em plano ou
   em face selecionada; indicação de esboço sub/totalmente definido.
3. **Features** — extrusão/revolução a partir do esboço (cego, até a próxima, passante, plano médio);
   seleção de faces/arestas no viewport; filete/chanfro só nas arestas escolhidas;
   padrão linear, padrão circular, espelhar; casca; nervura; furo assistido
   (passante, escareado, rebaixado, rosca métrica); por último varredura e loft.
4. **Sheet Metal** (implementação própria, o kernel não tem) — flange base a partir de esboço;
   flange de aresta; dobra por esboço; tabela material/espessura com fator K e raio de dobra;
   alívios de dobra e de canto; planificação e exportação **DXF** para corte.
5. **Avaliar** — medir (distâncias, ângulos, raios, XYZ, mín./máx.), propriedades de massa
   (com material e densidade), propriedades de seção, vista de seção, verificar geometria,
   análises de inclinação, espessura, zebra e curvatura, tempo de reconstrução por recurso.
   Medir, propriedades de massa e vista de seção podem ser antecipados se forem úteis antes.

Fase atual: Fases 1, 2 e 3 entregues (e quase toda a Fase 5 antecipada); **Fase 4** (Sheet Metal)
com o núcleo entregue (flange base, aba, flange de aresta, bainha, corte, planificar, DXF; modelo
próprio em `src/kernel/chapa.ts`). Canto automático entre abas vizinhas ✅. Árvore com "Chapa metálica" e "Padrão planificado" ✅, dobra esboçada, junta e flange de meia-esquadria ✅,
cantos (fechar canto, alívio de canto, quebrar canto) ✅. Desdobrar/dobrar (cortes atravessando dobras) e converter em chapa (com rasgos) ✅. Pendentes da Fase 4: inserir dobras (sólido com casca), margem/dedução de dobra por tabela. Pendentes da Fase 3: filete variável/de face, furo avançado.
Pendente da Fase 5: propriedades de seção. Estado detalhado em `docs/funcional/README.md`.
Referências a faces/arestas são por assinatura geométrica (`src/kernel/topologia.ts`): reencontra
a entidade mais parecida após regenerar; mudanças grandes na peça podem trocar a referência.

## Observações técnicas

- Erros do OpenCascade chegam como `WebAssembly.Exception` sem texto: traduzir para mensagem útil
  e marcar a feature com erro na árvore, sem interromper a regeneração das demais.
- Manter o kernel fora da thread da UI. Regenerações antigas são descartadas (`seq`).
- `vite.config.ts`: `base` vem de `BASE_PATH` (padrão `/`, Cloudflare); o workflow do GitHub Pages usa `/<nome do repositório>/`.
- Offline: o build gera `precache.json` (todos os arquivos) e carimba a versão do cache no `sw.js`
  (plugin `offline` em `vite.config.ts`). O service worker guarda na instalação só as páginas e os
  arquivos pequenos; o kernel `.wasm` (~23 MB, 7 MB comprimido) é guardado quando o WJCAD termina de
  carregá-lo (mensagem `guardar`, reaproveitando o cache HTTP: nada é baixado duas vezes). Não editar
  a versão do cache à mão.
