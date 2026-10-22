# CAD Tablet — contexto para o Claude

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
- Visualização: Three.js (`src/viewport.ts`), Z para cima, render só quando algo muda
- Modelo: lista de features serializada em JSON (`.cadt`), em `src/model.ts`
- PWA (manifest + `public/sw.js`), deploy automático no GitHub Pages via `.github/workflows/deploy.yml`
- Unidade: **mm** (sistema MMGS)

Gerenciador de pacotes: **pnpm** (não usar npm; segurança em `pnpm-workspace.yaml`:
scripts de instalação bloqueados exceto `onlyBuiltDependencies`, `minimumReleaseAge` de 3 dias).
Nova dependência só com justificativa, de projeto conhecido, e revisando o `pnpm-lock.yaml`.

Comandos: `pnpm dev` · `pnpm check` (tsc) · `pnpm teste` (kernel em Node) · `pnpm build`.
Antes de cada commit: `pnpm check && pnpm teste && pnpm build` devem passar.

## Decisões de produto (definidas pelo Johann)

- **Tema claro** (fundo claro no viewport e painéis).
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

Fase atual: Fases 1 e 2 entregues; próxima: **Fase 3** (features).
Limitação conhecida da Fase 2: esboço em face guarda o plano da face no momento da criação
(não acompanha a face se a peça mudar) — referência topológica fica para depois.

## Observações técnicas

- Erros do OpenCascade chegam como `WebAssembly.Exception` sem texto: traduzir para mensagem útil
  e marcar a feature com erro na árvore, sem interromper a regeneração das demais.
- Manter o kernel fora da thread da UI. Regenerações antigas são descartadas (`seq`).
- `vite.config.ts` usa `base: "/CAD/"` em build/preview (GitHub Pages).
