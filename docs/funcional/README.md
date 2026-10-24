# Especificação funcional — ambiente de Peça

Referência de **comportamento** para o JLSCAD: cada comando, suas caixas (subformulários)
e campos, tomando como modelo o fluxo de trabalho de CADs paramétricos profissionais
(o SOLIDWORKS é a referência que o Johann usa no dia a dia).

Regras (ver `CLAUDE.md`):

- Copiamos **fluxo, organização dos campos e comportamento**. Não copiamos ícones, cores da marca,
  logotipos, textos de ajuda nem nomes registrados ("FeatureManager", "PropertyManager",
  "CommandManager"…). Na interface usamos **nomes próprios em português**.
- Os nomes de referência aparecem entre parênteses só para orientar o desenvolvimento.

Arquivos:

| Área | Arquivo |
|---|---|
| Features (recursos sólidos, padrões, referência, curvas, gerais) | [features.md](features.md) |
| Sketch (esboço: entidades, ferramentas, cotas, relações) | [sketch.md](sketch.md) |
| Sheet Metal (chapa metálica) | [chapa.md](chapa.md) |
| Avaliar (medições, propriedades de massa, análises) | [avaliar.md](avaliar.md) |

## Estado da implementação (22/10/2026)

- **Features** ✅ extrusão/corte e revolução completos, furo assistido ISO, filete, chanfro, casca,
  nervura, inclinação, padrões linear/circular, espelhar, plano e eixo de referência, retrocesso,
  equações/variáveis globais, material. Pendentes: varredura, loft, ressalto por contorno
  (especificados em features.md §4–6), filete variável/de face,
  furo avançado, combinar/excluir corpo, rosca cosmética, Instant3D.
- **Sketch** ✅ Fase 2 + ponto, variantes de retângulo/círculo/arco/rasgo/polígono, filete e chanfro
  de esboço, estender, mover/copiar/girar, padrões de esboço, contornos sombreados.
- **Avaliar** ✅ medir, massa, vista de seção, verificar, inclinação, espessura, zebra, curvatura,
  desempenho. Pendente: propriedades de seção.
- **Sheet Metal**: Fase 4 (ainda não começou).
- **Barra de vistas** (topo do viewport) ✅ recolhida numa setinha; aberta mostra: ampliar para caber,
  zoom por área (arrastar retângulo; Esc cancela), vista de seção, orientação ▾ (vistas padrão e
  normal a), ocultar/mostrar itens ▾ (ocultar todos os tipos; planos, eixos, origem, esboços) e
  configurações de vista ▾ (estilo de exibição). Pendentes: vista anterior, aparência, cena.

Legenda de status em cada campo/comando:

- ✅ já existe no app
- 🟡 existe parcialmente (o que falta está indicado)
- F3, F4, F5… — fase do roteiro em que entra
- ⏸ fora do escopo atual (fica registrado, sem fase)

Convenção dos painéis de comando (vale para todos):

- Ao abrir um comando, o **painel do comando substitui a árvore** à esquerda; a árvore fica
  disponível flutuando sobre o viewport para selecionar referências.
- Cabeçalho do painel: **✓ OK**, **✕ Cancelar**, **👁 pré-visualização detalhada**, **📌 manter
  aberto** (repete o comando ao confirmar).
- Caixas **recolhíveis**; caixas opcionais têm **caixa de seleção no título** (ex.: Direção 2,
  Recurso fino) e só se expandem quando marcadas.
- Campos de seleção são **listas rosa/azul** que recebem itens clicados no viewport ou na árvore;
  o campo ativo fica destacado; clicar num item da lista destaca-o no modelo; Delete remove.
- Campos numéricos aceitam **expressões** (`=20/2`, variáveis globais) e têm setas ± com passo.
- **Pré-visualização** amarela/translúcida no viewport, com **alças de arrasto** (setas) para
  profundidades e ângulos; valores aparecem como rótulos editáveis no próprio modelo.
- **Canto de confirmação** no viewport (✓ / ✕) e **Enter = OK**, **Esc = Cancelar**.
- Botão direito no viewport durante o comando: OK, Cancelar, limpar seleções, inverter direção.
