# Sheet Metal — chapa metálica (Fase 4)

Implementação própria (o kernel não tem chapa): `src/kernel/chapa.ts` guarda a chapa como árvore
de **paredes** planas (contorno 2D + referencial) ligadas por **dobras** (aresta, ângulo, raio,
fator K). O sólido dobrado e o planificado saem do mesmo modelo, então o planificado é exato
(margem de dobra = ângulo × (R + K·t)). DXF em `src/kernel/dxf.ts`. Testes em `scripts/teste-recursos.ts`.

## Estado (24/10/2026)

| Comando | Status |
|---|---|
| Flange base: esboço fechado (placa) | ✅ |
| Flange base: perfil aberto só com linhas (cantos viram dobras), cego / plano médio / inverter | ✅ (arcos no perfil: F4) |
| Aba (Flange base com chapa já criada vira Aba) | ✅ |
| Flange de aresta: arestas, ângulo, comprimento (externo/interno virtual, tangente), posição (material interno/externo, dobra externa), raio próprio, inverter, deslocamentos com alívio retangular automático | ✅ |
| Bainha: fechada, aberta, enrolada; material interno/externo; inverter | ✅ (gota: F4) |
| Corte na chapa (normal à chapa, aparece no planificado) | ✅ (esboço numa face plana; atravessando dobras: F4) |
| Tabela material / espessura / raio / K (janela Material / K e caixa Bitolas) | 🟡 tabela fixa; editar e salvar tabela própria: F4 |
| Planificar (liga/desliga, linhas de dobra em laranja) | ✅ |
| Exportar DXF R12 (camadas CONTORNO, DOBRA_CIMA, DOBRA_BAIXO, NOTAS) + lista de corte | ✅ |
| Canto automático entre abas vizinhas da mesma flange de aresta ou bainha: meia-esquadria pela bissetriz das paredes, com **distância de folga** (padrão 0,25 mm); as dobras também são aparadas. No planificado o corte é perpendicular à chapa pela face de dentro (dobrada, a peça não colide; o canto fica com fresta de até t) | ✅ |
| Árvore: item **Chapa metálica** (parâmetros globais: bitola, espessura, raio, K; toque duplo edita) e **Padrão planificado** no fim (apagado com a peça dobrada; toque duplo planifica/dobra; Exportar DXF) | ✅ |
| Aba, Corte na chapa e Flange base sem esboço: pedem a face/plano, abrem o esboço e voltam ao comando ao sair dele; OK bloqueado sem esboço (e flange de aresta/bainha sem arestas) | ✅ |
| **Dobra esboçada**: linha(s) de esboço numa face plana; lado fixo = o maior (ou inverter); posição: linha de centro, material interno, material externo, dobra externa; ângulo, inverter direção, raio próprio; o planificado não muda de tamanho | ✅ (só linhas retas; flanges já feitas precisam estar no lado fixo) |
| **Junta**: degrau (dobra θ + trecho reto + dobra −θ) a partir de linha(s) de esboço numa face; deslocamento entre faces do mesmo lado / interno (vão) / total; posição da junta como na dobra esboçada; ângulo; raio próprio; lado fixo | ✅ (fixar comprimento projetado: F4) |
| Meia-esquadria, meia-esquadria, cantos, desdobrar/dobrar, converter em chapa, rasgar | F4 |
| Margem/dedução/tabela de dobra (só fator K hoje), alívio rasgado/oblongo | F4 |

Limitações conhecidas: extrusões e cortes comuns entre recursos de chapa são reaplicados quando a
chapa muda, mas filete, chanfro e casca feitos antes do último recurso de chapa se perdem; nenhum
recurso comum entra no planificado/DXF (para furos na chapa use **Corte na chapa**). Referências a arestas são por assinatura
geométrica (mudar muito a chapa pode trocar a aresta escolhida).

O resto deste arquivo é a especificação campo a campo (o que falta continua **F4**).

Conceitos comuns a todos os comandos:
- **Parâmetros de chapa** (do recurso "Chapa metálica" criado pela 1ª flange): espessura,
  raio de dobra, cálculo de dobra, alívio automático, material/tabela.
- **Cálculo de dobra**: Tabela de dobras · **Fator K** · Margem de dobra (bend allowance) ·
  Dedução de dobra (bend deduction) · Tabela de cálculo.
- **Alívio automático**: Retangular · Rasgado (tear) · Oblongo; proporção do alívio ou largura/profundidade.
- Cada comando pode **sobrepor** raio, cálculo de dobra e alívio ("personalizado").

---

## 1. Flange base / Aba (Base Flange/Tab)
Perfil: esboço fechado (placa) ou aberto (perfil dobrado)
- **Direção 1** (perfil aberto): condição final (Cego, Plano médio…), profundidade, inverter
- **Direção 2** (perfil aberto)
- **Bitolas de chapa**: usar tabela de bitolas, tabela, espessura/raio vindos da tabela
- **Parâmetros de chapa**: espessura, **inverter direção** (lado do material), raio de dobra
- **Margem de dobra**: Tabela · Fator K (valor) · Margem · Dedução · Tabela de cálculo
- **Alívio automático**: tipo, usar proporção (valor) ou largura/profundidade
- **Contornos selecionados**
- *Aba (Tab)*: com chapa existente, esboço fechado numa face vira aba da mesma espessura

## 2. Flange de aresta (Edge Flange)
- **Parâmetros da flange**: arestas (lista), **editar perfil da flange**, usar raio padrão / raio,
  distância de folga (entre flanges adjacentes) ✅
- **Ângulo**: ângulo da flange, face de referência, perpendicular / paralela à face
- **Comprimento da flange**: condição (Cego, Até o vértice), inverter, comprimento;
  medição: **Externo virtual** · **Interno virtual** · **Tangente à dobra**
- **Posição da flange**: **Material interno** · **Material externo** · **Dobra externa** ·
  Dobra a partir do virtual afiado · Tangente à dobra; **Aparar dobras laterais**;
  **Deslocamento** (condição, distância)
- Margem de dobra personalizada · Alívio personalizado (tipo, proporção)

## 3. Flange de meia-esquadria (Miter Flange)
Perfil: esboço aberto perpendicular à aresta
- **Parâmetros**: ao longo das arestas (cadeia), raio, posição da flange (interno/externo/dobra
  externa), aparar dobras laterais, distância de folga
- **Deslocamentos inicial/final**
- Margem de dobra e alívio personalizados

## 4. Bainha (Hem)
- **Arestas**, editar largura da bainha
- **Tipo e tamanho**: **Fechada** (comprimento) · **Aberta** (comprimento, folga) ·
  **Gota** (ângulo, raio) · **Enrolada** (ângulo, raio)
- Posição: material interno · material externo · dobra externa · inverter
- Folga de meia-esquadria · margem de dobra personalizada

## 5. Dobra esboçada (Sketched Bend) — ✅
Linha de esboço numa face plana da chapa
- **Face fixa**
- **Posição da dobra**: Linha de centro da dobra · Material interno · Material externo · Dobra externa
- **Ângulo**, inverter direção, raio
- Margem de dobra personalizada

## 6. Junta (Jog) — ✅ (salvo "fixar comprimento projetado")
- Face fixa, usar raio padrão / raio
- **Deslocamento da junta**: condição (Cego, Até o vértice…), distância,
  **posição da cota**: deslocamento externo · interno · total; **fixar comprimento projetado**
- **Posição da junta** (como na dobra esboçada), **ângulo da junta**
- Margem de dobra personalizada

## 7. Dobra cruzada (Cross Break) — ⏸
Face, direção, raio, ângulo (apenas visual/cosmético).

## 8. Dobras em loft / Flange varrida — ⏸
Loft entre dois perfis abertos (conformada / dobrada com nº de facetas); flange varrida por trajetória.

## 9. Cantos
### Fechar canto (Closed Corner)
- Faces a estender · faces correspondentes (automático)
- **Tipo de canto**: Topo (butt) · Sobreposto · Subposto; **distância de folga**;
  proporção de sobreposição
- Abrir região de dobra · faces coplanares · canto estreito · propagação automática
### Alívio de canto (Corner Relief)
- Tipo de canto: **2 dobras** · **3 dobras**; coletar todos os cantos
- **Tipo de alívio**: Retangular · Circular · Rasgado · Oblongo · Largura constante ·
  (3 dobras: completo, …)
- Centrado nas linhas de dobra · tangente à dobra · adicionar faces perpendiculares · folga · tamanho
### Canto soldado (Welded Corner) — ⏸
Canto, ponto de parada, filete, textura, nota de solda.
### Quebrar canto / Aparar canto (Break Corner)
- Arestas/cantos · **Tipo**: Chanfro (distância) · Filete (raio) · quebrar dos dois lados

## 10. Aba e rasgo (Tab and Slot) — ⏸
Aresta da aba, referências inicial/final, deslocamento, espaçamento (igual / nº de instâncias),
comprimento/altura da aba, comprimento/folga do rasgo, tipo de canto, rasgo passante.

## 11. Desdobrar / Dobrar (Unfold / Fold)
- **Face fixa** · **Dobras a desdobrar** (lista) · **Coletar todas as dobras**
- Uso: desdobrar → adicionar corte atravessando dobras → dobrar de volta

## 12. Planificar (Flatten / Flat Pattern)
- Liga/desliga a vista planificada (recurso "Padrão planificado" no fim da árvore)
- **Parâmetros do planificado**: face fixa · mesclar faces · simplificar dobras · mostrar rasgos ·
  tratamento de cantos · **direção do grão** · recriar padrão planificado
- **Caixa delimitadora** do planificado (comprimento × largura) — alimenta a lista de corte

## 13. Converter em chapa / Inserir dobras / Rasgar
- **Converter em chapa** (de sólido): face fixa, espessura, inverter espessura, manter corpo,
  **arestas de dobra** (lista), **arestas de rasgo** (encontradas), raio padrão, folga do rasgo,
  alívio automático
- **Inserir dobras** (casca de espessura constante): face fixa, raio, cálculo, alívio
- **Rasgar** (Rip): arestas, folga, direção

## 14. Cortes em chapa
- **Corte extrudado** com **Vincular à espessura** e **Corte normal** (perpendicular à chapa
  mesmo em faces dobradas): normal ao esboço · normal à chapa; otimizar geometria

## 15. Ferramentas de conformação e respiro — ⏸
- **Ferramenta de conformação** (biblioteca: louver, nervura estampada, extrusão): face de parada,
  faces a remover, ponto de inserção, ângulo, inverter ferramenta, vincular
- **Respiro** (Vent): limite, nervuras, longarinas, área de preenchimento, área de fluxo, filetes

## 16. Tabela de material/espessura (Gauge table) — F4
Material · espessura (bitola) · raio interno · **fator K** · alívio padrão. Editável no app,
salva no arquivo e reutilizável entre peças.

## 17. Lista de corte / propriedades da chapa — F4
Comprimento e largura da caixa delimitadora · espessura · nº de dobras · material · massa ·
**comprimento de corte** externo/interno · área · nº de recortes · tratamento superficial.

## 18. Exportar DXF/DWG do planificado — F4
- **Exportar**: geometria · arestas ocultas · recursos de biblioteca · ferramentas de conformação ·
  **linhas de dobra** · esboços · notas de dobra (ângulo, raio, direção ↑↓)
- **Opções**: camadas separadas (contorno, dobra ↑, dobra ↓, notas), mesclar entidades,
  remover entidades, unidade mm, versão DXF R12/2000
- **Tabela de dobras** (no desenho) — ⏸
