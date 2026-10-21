# CAD Tablet

CAD paramétrico simplificado, feito para rodar no navegador de um tablet Android
(e instalável como app pela opção "Adicionar à tela inicial" do Chrome).

Projeto próprio e independente: o fluxo de trabalho (esboço → feature → árvore de histórico)
é o mesmo conceito comum a vários CADs paramétricos, com interface e código originais.

## O que já funciona (v0.1)

- **Kernel B-Rep real** (OpenCascade via [replicad](https://replicad.xyz)), rodando num Web Worker
- **Árvore de features** com edição de cotas, reordenação, supressão e exclusão
- Features: **Extrusão**, **Corte**, **Revolução**, **Filete** e **Chanfro**
- Perfis: retângulo (com raio de canto), círculo e polígono regular, nos planos XY / XZ / YZ
- **Desfazer / refazer** e salvamento automático no navegador
- **Salvar / abrir** projeto (`.cadt`, JSON) e **exportar STEP e STL**
- Viewport com gestos de toque: 1 dedo orbita, 2 dedos fazem zoom e pan, toque duplo enquadra
- Funciona offline depois da primeira visita (service worker)

## Rodar no computador

```bash
npm install
npm run dev        # abre em http://localhost:5173 (e na rede local, para testar no tablet)
npm run check      # verificação de tipos
npm run teste      # testa o kernel em Node (volumes da peça exemplo)
npm run build      # gera a versão de produção em dist/
```

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
  main.ts                interface, histórico, arquivos
scripts/teste-kernel.ts  teste do kernel em Node
```

## Próximos passos

1. Esboço 2D livre com restrições (linhas, arcos, cotas) usando o solver PlaneGCS
2. Seleção de faces/arestas no viewport (extrudar a partir de uma face, filete só em arestas escolhidas)
3. Padrões linear/circular e espelhamento
4. Importar STEP
5. Montagens com posicionamentos (mates)

## Licenças de terceiros

OpenCascade / replicad-opencascadejs: LGPL-2.1 · replicad: MIT · Three.js: MIT
