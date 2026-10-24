# Referência: guia introdutório do CAD profissional × WJCAD

O Johann forneceu o guia introdutório oficial do CAD de referência (versão em inglês,
135 páginas). O arquivo **não vai para o repositório**. Aqui fica só a análise, com as nossas
palavras: o que o guia apresenta como fluxo básico, como está no WJCAD e o que falta.
Use este arquivo junto com `features.md`, `sketch.md`, `chapa.md` e `avaliar.md` ao planejar pedidos.

Análise feita sobre as páginas 1–80: fundamentos, interface, esboço, peças, montagens e início
de desenhos. As páginas 80–135 (resto de desenhos, tarefas de engenharia, lição passo a passo,
exercícios) não puderam ser lidas pelo conector do Drive. O conteúdo delas é conhecido e
coberto pelos itens abaixo, mas vale conferir se o Johann quiser.

Legenda: ✅ igual ao fluxo do guia · 🟡 parcial · ❌ falta · 🚫 fora do escopo (decisão do projeto)

## 1. Interface e interação

| Tema do guia | WJCAD | Status |
|---|---|---|
| Árvore de histórico à esquerda (editar, suprimir, reordenar) | árvore com planos, origem, recursos, esboços aninhados | ✅ |
| Painel de propriedades do comando (substitui a árvore) | painel de comando à esquerda com ✓/✕ | ✅ |
| Gerenciador de configurações (variações da peça) | item na árvore + tabela de configurações | ✅ |
| Menus com submenus e menu de contexto (botão direito) | ☰ + menu de contexto no viewport e na árvore | ✅ |
| Barra de comandos por abas, conforme o documento | abas Features / Sketch / Sheet Metal / Avaliar | ✅ |
| Barra de atalhos (tecla S) | barra de atalhos no cursor | ✅ |
| Barra de contexto ao selecionar | barra de contexto no viewport e na árvore | ✅ |
| Mouse: esquerdo seleciona, meio gira, Ctrl+meio arrasta, roda aproxima, direito menu | igual | ✅ |
| **Gestos de mouse** (direito + arrastar → guia radial com 8 comandos) | — | 🚫 (decisão do Johann, 24/10/2026) |
| **Alças de arrasto** no viewport (ex.: profundidade da extrusão) | setas na extrusão/corte (D1, D2) | 🟡 (revolução ⏸) |
| Pré-visualização dos recursos (extrusão, corte, varredura, loft, padrões) | pré-visualização sombreada | ✅ |
| Retorno no cursor (tipo de entidade, ponto médio, inferências) | caixinha de relações, encaixes, ponto médio | ✅ |
| **Filtro de seleção** (só arestas, só faces, só vértices…) | barra de vistas → funil ▾; F5 liga/desliga; X/E/V | ✅ |
| **Selecionar outro** (entidade escondida atrás de outra) | botão direito → lista com realce | ✅ |
| Selecionar laço/cadeia de arestas para filete | selecionar cadeia tangente no filete | 🟡 |

## 2. Esboço

| Tema do guia | WJCAD | Status |
|---|---|---|
| Origem como âncora; começar o esboço nela | origem e eixos do esboço, encaixe | ✅ |
| Esboçar em planos padrão (frontal, superior, lateral), em planos criados e em faces planas | planos, faces e planos criados | ✅ |
| Linha de centro (construção) para simetria e revolução | linha de centro, geometria de construção | ✅ |
| Cotas que comandam × cotas de referência (só medem) | cota inteligente; "cota de referência" | ✅ |
| Cores de definição: sub (azul), total (preto), superdefinido | azul / preto / vermelho (o guia usa amarelo/vermelho para conflito) | ✅ |
| Arrastar o que está subdefinido | arrastar pontos, linhas, raios | ✅ |
| Superdefinido: apagar o excesso | "Excluir relações em conflito", Exibir/Excluir relações | ✅ |
| Relações por inferência (horizontal, vertical, paralela ao desenhar) | encaixes H/V criam relações | ✅ |
| Adicionar relações (tangente, concêntrica, igual…) | caixinha no ponteiro + painel | ✅ |
| **Espelhamento dinâmico** (desenha de um lado, aparece do outro) | Espelhar ▾ → Espelhamento dinâmico | ✅ |
| Converter entidades (projetar arestas da peça) | converter + referência do modelo | ✅ |
| Offset de entidades (ex.: aba/rebordo de tampa) | painel completo | ✅ |
| Rasgo, arco tangente, spline, elipse | todos | ✅ |
| Cotar a spline para manter a forma | cotas nos pontos da spline | 🟡 (alças de tangência da spline faltam) |
| Esboço 3D | — | ❌ (previsto por último) |

## 3. Recursos de peça (os usados nos exemplos do guia)

| Exemplo do guia | Recurso | Status |
|---|---|---|
| Bancada: base e rebordo | extrusão; rebordo com converter entidades | ✅ |
| Abertura da pia | corte extrudado com perfil de elipse | ✅ |
| Cuba | loft entre elipse (projetada) e círculo em plano deslocado | ✅ |
| Cuba oca | casca removendo a face de cima | ✅ |
| Cantos | filete por arestas (deixar por último) | ✅ |
| Bica da torneira | varredura de perfil circular ao longo de arco + linha tangente | ✅ |
| Manopla | revolução com linha de centro, linhas, arco tangente e spline | ✅ |
| Porta do armário | chanfro nas arestas | ✅ |
| Moldura | extrusão plano médio, corte a 45° maior que a peça, espelhar o corte | ✅ |
| Moldura curta/longa | **configurações** | ✅ |
| Furação | furo assistido (rebaixo, escareado, rosca) | ✅ |
| Recurso aplicado sem esboço (filete, chanfro, casca) | igual | ✅ |
| Editar recurso, editar esboço | menu de contexto, árvore | ✅ |
| **Duplo clique no recurso mostra as cotas no modelo e edita no lugar** | duplo clique/toque numa face | ✅ |
| Ocultar/mostrar esboços, planos, eixos | olho na árvore + Ocultar/mostrar itens | ✅ |
| Suprimir / reativar recurso | árvore | ✅ |
| Barra de retrocesso | árvore | ✅ |

## 4. Chapa metálica (dobradiça do guia) — Fase 4

| Passo do guia | Especificado em `chapa.md` | Status |
|---|---|---|
| Flange base a partir de retângulo (vira peça de chapa) | §1 | ✅ |
| Aba (esboço numa face vira aba com a mesma espessura, para o lado certo) | §1 | ✅ |
| Padrão linear da aba (13 abas a cada 50 mm) | padrão de recursos | 🟡 (padrão de recursos de chapa: F4) |
| Bainha enrolada nas abas | §4 | ✅ |
| Alternativa: flange base de linha + arco tangente, cortes em padrão | §1 | 🟡 (perfil aberto só com linhas) |

## 5. Avaliar

| Tema do guia | WJCAD | Status |
|---|---|---|
| Medir (usado para decidir a cota de posição) | Medir | ✅ |
| Vista de seção | Vista de seção | ✅ |
| Interferência/colisão | só em montagem | 🚫 |

## 6. Fora do escopo atual (registrado)

- **Montagens** (posicionamentos, projeto no contexto, vista explodida, colisão) 🚫: o projeto é
  só de peça por decisão do Johann. Grandes montagens já foram descartadas por enquanto.
- **Desenhos 2D** (folhas, formato, 3 vistas padrão, vistas projetadas/seção/detalhe, cotas
  do modelo, notas, tolerâncias, lista de materiais) 🚫: não está no roteiro. Candidato
  natural para uma fase futura, se o Johann quiser.
- Simulação, animação, gerenciamento de arquivos, biblioteca de peças padrão 🚫.

## 7. Lacunas priorizadas (sugestão)

Rápidas, no fluxo básico do guia — **entregues** (24/10/2026):
1. ✅ **Duplo clique no recurso**: cotas do esboço e do recurso no modelo, editáveis no lugar.
2. 🟡 **Alças de arrasto**: extrusão/corte ✅; ângulo da revolução fica para depois.
3. ✅ **Selecionar outro**.
4. ✅ **Espelhamento dinâmico** no esboço.

Médias:
5. ✅ **Filtro de seleção** global (faces / arestas / vértices / planos / eixos / curvas).
6. 🚫 ~~Gestos de mouse/caneta~~ — fora do projeto (decisão do Johann).
7. ✅ **Configurações da peça**: variações de cotas e de supressão no mesmo arquivo.

Grandes:
8. 🟡 **Chapa metálica** (Fase 4): flange base, aba, flange de aresta, bainha, corte, planificado e DXF ✅; dobra esboçada, cantos e o resto em `chapa.md`.
9. **Desenhos 2D**, se entrar no roteiro.
