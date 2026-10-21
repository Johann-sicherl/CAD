# CAD Tablet

CAD paramétrico simplificado, feito para rodar no navegador de um tablet Android
(e instalável como app pela opção "Adicionar à tela inicial" do Chrome).

Projeto próprio e independente: o fluxo de trabalho (esboço → feature → árvore de histórico)
é o mesmo conceito comum a vários CADs paramétricos, com interface e código originais.

## O que já funciona

**Esboço (Fase 2)** — aba Sketch:
- Linha (encadeada), retângulo, círculo, arco por 3 pontos, rasgo, polígono regular, spline
- Aparar, offset de cadeias, espelhar em torno de linha ou eixo
- Cota inteligente (linear, horizontal/vertical, ponto-linha, raio, diâmetro, ângulo) com
  cotas de referência; relações coincidente, horizontal, vertical, paralelo, perpendicular,
  colinear, tangente, igual, concêntrico, ponto médio, simétrico e fixo
- Solver PlaneGCS: esboço azul = subdefinido, preto = totalmente definido, vermelho = conflito,
  com contagem de graus de liberdade; arrastar move o que ainda está livre
- Esboçar num plano de referência ou numa face plana da peça; extrusão/revolução/cortes usam o
  esboço (contornos internos viram furos; revolução em torno da 1ª linha de construção)
- Caneta desenha e o dedo navega; sem caneta o dedo desenha com encaixes maiores e lupa;
  no computador, botão esquerdo desenha e atalhos de teclado (L, R, C, A, D, Esc…)

**Base (v0.1):**

- **Kernel B-Rep real** (OpenCascade via [replicad](https://replicad.xyz)), rodando num Web Worker
- **Árvore de features** com edição de cotas, reordenação, supressão e exclusão
- Features: **Extrusão**, **Corte**, **Revolução**, **Filete** e **Chanfro**
- Perfis: retângulo (com raio de canto), círculo e polígono regular, nos planos XY / XZ / YZ
- **Desfazer / refazer** e salvamento automático no navegador
- **Salvar / abrir** projeto (`.cadt`, JSON) e **exportar STEP e STL**
- Viewport com gestos de toque: 1 dedo orbita, 2 dedos fazem zoom e pan, toque duplo enquadra
- Funciona offline depois da primeira visita (service worker)

## Rodar no computador

Requer Node 22+ e o gerenciador de pacotes **pnpm** (`corepack enable` instala a versão
fixada em `package.json`).

```bash
pnpm install       # instala exatamente as versões travadas em pnpm-lock.yaml
pnpm dev           # abre em http://localhost:5173 (e na rede local, para testar no tablet)
pnpm check         # verificação de tipos
pnpm teste         # testa o kernel em Node (volumes da peça exemplo)
pnpm build         # gera a versão de produção em dist/
```

## Dependências

Usamos **pnpm** em vez de npm por segurança contra pacotes maliciosos
(configuração em `pnpm-workspace.yaml`):

- **Scripts de instalação bloqueados**: só os pacotes listados em `onlyBuiltDependencies`
  (hoje apenas o `esbuild`) podem executar código durante a instalação.
- **Versões novas demais são recusadas**: `minimumReleaseAge` exige que uma versão tenha
  pelo menos 3 dias de publicada; pacotes comprometidos costumam ser removidos antes disso.
- **Versões travadas**: `pnpm-lock.yaml` fixa versão e hash de cada pacote; o deploy usa
  `pnpm install --frozen-lockfile`, que falha se algo não bater.

Regras: poucas dependências, só de projetos conhecidos; revisar mudanças no `pnpm-lock.yaml`;
rodar `pnpm audit` de vez em quando.

## Publicar no tablet (GitHub Pages)

1. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Cada `push` na branch `main` publica automaticamente em
   `https://johann-sicherl.github.io/CAD/`
3. No tablet, abra esse endereço no Chrome → menu ⋮ → **Adicionar à tela inicial**

## Estrutura

```
src/
  model.ts               tipos das features e do documento (formato .cadt)
  kernel/regenerar.ts    árvore de features → sólido B-Rep → malha (testável em Node)
  kernel/worker.ts       Web Worker que carrega o OpenCascade (.wasm)
  kernel/cliente.ts      ponte UI ↔ worker
  viewport.ts            visualização 3D (Three.js) e gestos de toque
  propriedades.ts        painel de edição das cotas
  comandos.ts            abas Features / Sketch / Sheet Metal e seus comandos
  icones.ts              ícones SVG próprios
  main.ts                interface, árvore, histórico, arquivos
  esboco/                editor de esboço: geometria, solver (PlaneGCS), operações,
                         cotas, camada 3D e painel
scripts/teste-kernel.ts  teste do kernel em Node
scripts/teste-esboco.ts  teste do esboço (solver, aparar/offset/espelhar, sólidos)
```

## Próximos passos (roteiro)

- **Fase 3 — Features:** condições de fim da extrusão (cego, até a próxima, passante, plano médio),
  seleção de faces/arestas, filete/chanfro em arestas escolhidas, padrões, espelhar, casca,
  nervura, furo assistido; depois varredura e loft
- **Fase 4 — Sheet Metal:** flange base/de aresta, dobras, fator K, alívios, planificação e DXF

## Licenças de terceiros

OpenCascade / replicad-opencascadejs: LGPL-2.1 · PlaneGCS (@salusoft89/planegcs, do FreeCAD):
LGPL-2.0+ · replicad: MIT · Three.js: MIT
