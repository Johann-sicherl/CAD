# WJFlow — escoamento de ar nas peças do WJCAD

Face do WJProMaster para simular o **escoamento de ar** em volta e por dentro de qualquer peça
projetada no WJCAD: veículos, aeronaves, drones, tubulações abertas, dutos e motores EDF.
Roda no **celular, tablet e computador** (navegador). Neste início, **só ar**, isotérmico.

- Página: `flow/` · código: `src/flow/` · motor testado: `src/flow/lbm.ts` (`scripts/teste-flow.ts`)
- Arquivo: `.wjflow` (estudo + peça compactada) salvo no cofre do WJPDM (pasta "Escoamento") ·
  autosave no IndexedDB `wjflow` · teste do aparelho em `flow/aparelho/`
- Status: **A0 ✅** (teste do aparelho) · **A1 🟡** (túnel externo com a peça; faltam simetria e
  validação do cilindro, §9). O restante está planejado (fases A2–A6).

Legenda: ✅ existe · 🟡 parcial · **A0…A6** fase deste documento · ⏸ registrado, fora do escopo atual.

---

## 1. Resumo da decisão

| Pergunta | Resposta |
|---|---|
| Dá para simular no tablet? | **Sim, com fidelidade de engenharia preliminar:** padrão do escoamento, esteira, separação grosseira, zonas de pressão, comparação entre versões da peça, forças com erro típico de 10–30 %. |
| O que não dá no tablet? | Coeficientes absolutos com precisão de túnel de vento (±2–5 %), camada limite resolvida, transição laminar–turbulenta, crise do arrasto, rotor girando com pás resolvidas. Isso fica para o **servidor** (A6). |
| Método | **Lattice-Boltzmann (LBM) D3Q19** em **WebGPU** (compute shader). Malha cartesiana de voxels gerada da peça, sem malhador de CFD. Turbulência por **LES** (Smagorinsky; depois WALE/cumulante). |
| Por que LBM e não volumes finitos (RANS)? | É explícito e local (cada célula só fala com as 18 vizinhas). Isso é perfeito para GPU. Também não precisa de malha ajustada ao corpo (a parte mais frágil e cara de um CFD clássico), aceita geometria "suja" e é transiente por natureza (mostra o escoamento evoluindo). |
| Onde fica no ecossistema | **Face separada** (como WJPlan, WJPDM…). O WJCAD continua sem simulação (decisão do Johann). O WJFlow lê a peça do WJCAD/WJPDM. |

## 2. Casos de uso (pedidos do Johann)

1. **Veículos** (carros, carenagens): arrasto, sustentação/downforce, esteira, efeito do solo.
2. **Aeronaves e drones** (asas, fuselagens, perfis): sustentação, arrasto, momento, polar por
   ângulo de ataque, estol aproximado.
3. **Tubulações abertas e dutos:** vazão, velocidade média, perda de carga (Δp), distribuição
   de velocidade, recirculação em curvas e expansões.
4. **Motores EDF** (*electric ducted fan*): empuxo, vazão mássica, velocidade de saída, efeito do
   bocal de entrada (lábio) e do bocal de saída, interação do duto com o corpo.
5. **Testes livres:** qualquer peça do WJCAD num túnel de vento virtual.

## 3. Física — o que o simulador tem de respeitar

### 3.1 Equações governantes

Ar como **fluido newtoniano**, gás ideal, sem gravidade (o empuxo de Arquimedes no ar é desprezível
para essas peças):

- Continuidade: ∂ρ/∂t + ∇·(ρ**u**) = 0
- Quantidade de movimento (Navier–Stokes): ρ(∂**u**/∂t + **u**·∇**u**) = −∇p + μ∇²**u** + **f**
- Abaixo de **Mach 0,3** o escoamento é praticamente incompressível. A variação de densidade é
  Δρ/ρ ≈ M²/2: 4,5 % a M = 0,3 e 0,5 % a M = 0,1. Então ∇·**u** = 0 é uma boa aproximação.

**Propriedades do ar** (padrão do app; editáveis):

| Condição | ρ (kg/m³) | μ (Pa·s) | ν (m²/s) | c (m/s) |
|---|---|---|---|---|
| 20 °C, 101 325 Pa | 1,204 | 1,825·10⁻⁵ | 1,516·10⁻⁵ | 343,2 |
| 15 °C, nível do mar (ISA) | 1,225 | 1,789·10⁻⁵ | 1,461·10⁻⁵ | 340,3 |

- A **temperatura** entra pela lei de Sutherland: μ = μ₀ (T/T₀)^1,5 (T₀ + S)/(T + S), com S = 110,4 K.
- A **altitude** entra pela atmosfera padrão ISA: T = 288,15 − 0,0065 h; p = 101 325 (T/288,15)^5,2559.
- Isso vale para drones e aeronaves (A4).

### 3.2 Números adimensionais (o que governa cada caso)

| Número | Definição | Para que serve |
|---|---|---|
| Reynolds | Re = U L / ν | Inércia × viscosidade. Define laminar/turbulento, separação, Cd. **É o número que precisa bater com o real.** |
| Mach | M = U / c | Compressibilidade. Até 0,3, incompressível. |
| Strouhal | St = f L / U | Frequência de desprendimento de vórtices (cilindro ≈ 0,2). |
| Pressão dinâmica | q = ½ρU² | Escala de pressões e forças. |
| Coef. de pressão | Cp = (p − p∞)/q | Mapa de pressão na superfície (Cp = 1 no ponto de estagnação). |
| Coef. de força | Cd = D/(q A), Cl = L/(q A) | Arrasto e sustentação, com A = área de referência (frontal para carro, alar para asa). |
| Coef. de momento | Cm = M/(q A c) | Momento de arfagem (c = corda de referência). |
| y⁺ | y⁺ = y u_τ / ν, u_τ = √(τ_w/ρ) | Altura da 1ª célula em unidades de parede. Decide se a camada limite é resolvida (y⁺ ≈ 1) ou modelada (30 < y⁺ < 300). |

**Ordens de grandeza dos casos do Johann** (ar a 20 °C):

| Caso | L | U | Re | M |
|---|---|---|---|---|
| Carro | 4 m | 30 m/s (108 km/h) | 7,9·10⁶ | 0,09 |
| Drone / aeromodelo (corda) | 0,2 m | 15 m/s | 2,0·10⁵ | 0,04 |
| Tubo de 50 mm | 0,05 m | 10 m/s | 3,3·10⁴ | 0,03 |
| Jato de um EDF de 70 mm | 0,07 m | 60 m/s | 2,8·10⁵ | 0,17 |
| Ponta da pá do rotor do EDF | — | 150–250 m/s | — | **0,45–0,75** |

**Consequência direta:** a ponta da pá do EDF é compressível e muito fina. O rotor não é
resolvido. Ele vira um **disco atuador** (força de corpo; §3.6). Todo o resto fica abaixo de M 0,3.

### 3.3 Camada limite, transição e turbulência

**Camada limite:**
- Laminar em placa plana: δ ≈ 5 x / √Re_x.
- Turbulenta: δ ≈ 0,37 x / Re_x^0,2.
- A transição acontece em Re_x ≈ 5·10⁵ (placa lisa) e em Re ≈ 2 300–4 000 em tubos.

**Escalas de Kolmogorov:** a menor escala turbulenta é η ≈ L·Re^(−3/4). Disso saem os custos:
- **DNS** (resolver tudo): ~Re^(9/4) células e ~Re³ operações. Um carro (Re ≈ 10⁷) daria ~10¹⁶
  células, impossível em qualquer computador.
- **LES com parede resolvida:** ~Re^(13/7) células.
- **LES com modelo de parede:** ~Re células.
- **RANS** (média temporal + modelo k-ω SST): ~10⁶–10⁷ células, mas exige malha de camada limite.

**Conclusão para o tablet:**
- Com 1–4 milhões de células, a malha resolve as **grandes estruturas** (esteira, bolhas de
  separação, vórtices de ponta de asa e de coluna A).
- A camada limite **não** é resolvida: o Re da célula U·Δx/ν fica entre 10³ e 10⁵.
- Por isso o método é **LES sub-resolvido**. O padrão do escoamento sai qualitativamente correto,
  e as forças saem com erro moderado.
- O **modelo de parede** (A5) corrige parte do atrito.

**Separação e crise do arrasto:**
- A separação em corpos rombudos (traseira de carro, esfera) é dominada pela geometria. Por isso o
  LBM grosseiro acerta bem o padrão.
- Em corpos arredondados, o ponto de separação depende do estado da camada limite. Exemplo: a crise
  do arrasto da esfera em Re ≈ 3·10⁵, onde o Cd cai de 0,47 para ~0,1.
- **Isso o tablet não captura.** O app avisa quando o Re do caso estiver na faixa de transição.

### 3.4 Escoamento interno (tubulações e dutos)

- Conservação: vazão Q = ∫**u**·d**A**; continuidade A₁V₁ = A₂V₂; Bernoulli com perdas:
  p₁ + ½ρV₁² = p₂ + ½ρV₂² + Δp_perdas.
- **Laminar (Hagen–Poiseuille):** u(r) = 2V̄(1 − r²/R²), f = 64/Re.
- **Turbulento:** Darcy–Weisbach Δp = f (L/D) ½ρV̄², com f de Colebrook–White
  1/√f = −2 log₁₀(ε/(3,7D) + 2,51/(Re√f)), ou da forma explícita de Haaland
  1/√f = −1,8 log₁₀[(ε/D/3,7)^1,11 + 6,9/Re].
- **Perdas localizadas:** Δp = K ½ρV² (curvas, expansões, contrações, entradas com/sem lábio).
  O WJFlow **calcula** K para a geometria real e compara com a tabela clássica.
- **Comprimento de entrada:** laminar L_e ≈ 0,05 Re D; turbulento L_e ≈ 4,4 Re^(1/6) D.
  - O app prolonga entradas e saídas abertas automaticamente (no mínimo 5–10 D), para o perfil
    chegar desenvolvido e a saída não contaminar o resultado.
- **Validação interna:** perfil parabólico (exato, já testado ✅), Δp × Moody, expansão súbita
  (Borda–Carnot: K = (1 − A₁/A₂)²).

### 3.5 Aerodinâmica externa (veículos e aeronaves)

**Forças:**
- F = ∮(−p **n** + **τ**·**n**) dA (pressão + atrito).
- No LBM a força sai pela **troca de momento** nas ligações fluido–sólido:
  F = Σ cᵢ (f̃ᵢ* + f̃_ōpp) sobre as ligações cortadas. É exata no esquema de bounce-back, barata e
  não precisa interpolar pressão.

**Asas:**
- Teoria de perfil fino: Cl = 2π α (α em rad), Cl_α ≈ 0,11/grau.
- Asa finita (linha sustentadora): CL_α ≈ 2π AR/(AR + 2).
- Arrasto induzido: CDi = CL²/(π e AR).
- O estol começa entre 12 e 16° em perfis comuns.

**Veículos:**
- Faixas de Cd: carro de passeio 0,25–0,35; corpo de Ahmed 25° ≈ 0,29.
- O solo **não** pode ser parede parada. Ele cria uma camada limite falsa. Usar **solo móvel**
  (parede com velocidade U∞) e rodas girando (parede com velocidade tangencial).

**Túnel virtual (dimensões do domínio):**

| Região | Medida (L = comprimento do corpo) |
|---|---|
| Montante | 2–3 L |
| Jusante | 5–8 L (a esteira precisa sair) |
| Laterais e teto | **bloqueio** A_corpo/A_túnel ≤ 5 % |

Acima do bloqueio de 5 %, o app aplica a correção de bloqueio (Maskell) e avisa. O protótipo usa
2:1:1 com a esfera a 1/4 do comprimento.

### 3.6 EDF e propulsão: disco atuador

O rotor não é resolvido (M de ponta 0,45–0,75, pás finas). Ele é modelado como **disco atuador**:
uma região fina de células com força de corpo axial (e, opcionalmente, tangencial para o giro).

**Teoria do momento (Rankine–Froude):**

| Grandeza | Fórmula |
|---|---|
| Empuxo | T = ṁ (V_e − V₀), com ṁ = ρ A V_disco |
| Velocidade no disco | V_disco = (V₀ + V_e)/2 |
| Potência ideal | P_ideal = T·V_disco |
| Estático (V₀ = 0) | V_e = √(2T/(ρ A_e)) e P_ideal = √(T³/(2ρA)) |

**Como entra no LBM:**
- Força por volume g = T / (A·espessura) nas células do disco.
- Implementada com o termo de força de **Guo** (já no motor e verificado na GPU ✅, hoje uniforme).
  Na A3 vira campo por célula.

**Entradas do usuário (A3):**
1. empuxo alvo, **ou**
2. curva do ventilador Δp(Q), que é o mais fiel: o ponto de operação sai do equilíbrio entre a
   curva do ventilador e a curva do duto, **ou**
3. rotação + diâmetro + coeficientes (C_T, C_P) do fabricante.

**Saídas:**
- empuxo, vazão mássica, V_e e potência ideal/estimada;
- eficiência de Froude η = 2/(1 + V_e/V₀);
- perdas no lábio de entrada e no bocal;
- razão de área de saída FSA (*fan swept area*). Em EDF, o ótimo típico é 80–90 % da área varrida.

**Validação:** empuxo estático do disco contra a teoria do momento (±5 % esperado, porque o
modelo é o mesmo); duto com bocal contra dados de catálogo.

## 4. Método numérico

### 4.1 Lattice-Boltzmann D3Q19 (implementado ✅)

**Variáveis:**
- 19 populações fᵢ por célula: velocidades discretas cᵢ = repouso, 6 faces e 12 arestas.
- Pesos wᵢ = 1/3, 1/18, 1/36.

**Passo de tempo:**
- Streaming: fᵢ(x + cᵢ, t + 1) = fᵢ*(x, t).
- Colisão: fᵢ* = fᵢ + ω(fᵢᵉᵠ − fᵢ) + Sᵢ.
- Equilíbrio de Maxwell–Boltzmann truncado:
  fᵢᵉᵠ = wᵢ ρ (1 + 3 cᵢ·u + 4,5 (cᵢ·u)² − 1,5 u²).

**Macroscópicas:**
- ρ = Σfᵢ; ρu = Σcᵢfᵢ (+ ½**g** com força).
- p = cs²ρ, com cs² = 1/3 (a pressão sai da densidade).

**Pela expansão de Chapman–Enskog:**
- recupera Navier–Stokes com **ν = cs²(τ − ½)**, com erro O(Ma²);
- **estabilidade:** τ > ½;
- **u_rede ≤ 0,1** (o protótipo usa 0,05 → Ma_rede ≈ 0,087, erro de compressibilidade < 1 %).

**Detalhes de implementação (verificados nos testes ✅):**
- **Populações deslocadas** f̃ = f − w (ar parado = 0): ganha precisão em FP32 e torna o FP16
  viável.
- Esquema **pull** com dois buffers (ping-pong), um thread por **par** de células em x.

**Colisão:**

| Operador | Status | Observação |
|---|---|---|
| BGK | ✅ | O mais simples. Instável quando τ → ½. |
| BGK + **LES Smagorinsky** (Hou et al. 1996) | ✅ | τ_ef = ½(τ₀ + √(τ₀² + 18√2 Cs² \|Π\|/ρ)), Cs ≈ 0,1–0,17, com Π = Σcᵢcᵢ(fᵢ − fᵢᵉᵠ). Barato: o tensor de tensões já sai das populações, sem derivada numérica. |
| TRT | A5 | Corrige o erro de parede dependente de τ. |
| **Regularizado** (Latt & Chopard 2006) + LES | ✅ (A1, padrão do app) | f* = fᵉᵠ + (1 − ω)·wᵢ·(3cᵢ·Jⁿᵉᵠ + 4,5 Qᵢ:Πⁿᵉᵠ). Elimina os modos "fantasma" que viravam ruído em xadrez e instabilidade com τ₀ ≈ ½ (Re 10⁵, peça do WJCAD). Jⁿᵉᵠ = −g/2 com força: sem esse termo, o impulso da força de Guo vira g·(1,5 − ω/2) (o Poiseuille errava 41 % com τ = 0,55; com o termo, ≤ 0,8 % em τ de 0,55 a 1,2) |
| Parte volumétrica com ω_b = 1 | ✅ | Com τ ≈ ½, a viscosidade volumétrica do LBM some e as ondas de pressão não amortecem: o Cd da peça do WJCAD oscilava entre 1,2 e 2,8. O traço de Π relaxa com ω_b = 1, o que não muda o escoamento incompressível (testes de Taylor–Green e Poiseuille iguais) |
| Cumulante (Geier 2015) | A5 | Mais preciso em Re alto; só se o regularizado não bastar. |
| WALE | A5 | Substitui o Smagorinsky perto de paredes (amortece a viscosidade turbulenta). |

### 4.2 Escala: do problema real para a rede (`escalar()` ✅)

Dados L (m), U (m/s) e N células em L:
- Δx = L/N
- Δt = u_rede·Δx/U
- ν_rede = ν Δt/Δx²
- τ₀ = 3ν_rede + ½

O **Re é preservado** (mesmo ν físico). Exemplo do carro (4 m, 30 m/s, N = 200):
- Δx = 2 cm e Δt = 33 µs;
- τ₀ = 0,500004, ou seja, só funciona com LES/cumulante;
- o Re da célula fica em 40 000: lei de parede obrigatória (A5).

**Tempo de simulação:**
- uma **travessia** (o ar cruza o domínio uma vez) leva N_x/u_rede passos (5 120 passos em
  256 células);
- resultados de força estáveis pedem **2–4 travessias** e depois uma média temporal de mais 1–2.

### 4.3 Condições de contorno

| Contorno | Método | Status |
|---|---|---|
| Parede sólida parada | bounce-back no meio do caminho (2ª ordem em paredes alinhadas, "escada" em curvas) | ✅ |
| Parede curva precisa | bounce-back interpolado (Bouzidi 2001), usando a distância real à superfície da malha | A5 |
| Parede móvel (solo móvel, roda) | bounce-back com termo de velocidade: −2wᵢρ(cᵢ·u_w)/cs² | A4 |
| Entrada de velocidade/vazão | equilíbrio imposto ✅, com **partida suave**: o ar começa parado e a velocidade das bordas sobe de 0 a U∞ (cosseno) no primeiro quarto de travessia, para reduzir as ondas de pressão da partida; regularizado (Latt 2008) em A5 | 🟡 |
| Saída de pressão | equilíbrio com ρ = 1 e a velocidade da célula anterior (gradiente nulo) ✅ | ✅ |
| Laterais do túnel | equilíbrio da corrente livre ✅; deslizamento livre (simetria) depois | 🟡 |
| Plano de simetria | reflexão especular (corta a malha pela metade em peças simétricas) | A1 (falta) |
| Zona esponja | τ₀ cresce até τ₀ + 0,5 (quadrático) nos últimos 12 % do túnel ✅ | ✅ |
| Camadas absorventes | nas duas pontas (6 % na entrada, a zona esponja na saída): f ← f − σ(x)·(f − fᵉᵠ∞), σ até 0,1. Tiram o modo acústico de ¼ de onda que ricocheteava entre entrada e saída. Partida brusca num túnel vazio: δρ residual de 1,5·10⁻⁵ para 1,1·10⁻⁸ ✅ | ✅ |
| Disco atuador (EDF) | força de corpo de Guo por célula | A3 (força uniforme ✅) |

### 4.4 Geometria → voxels

1. **Origem da peça:**
   - **WJCAD ✅:** menu Arquivo → **Abrir no WJFlow** manda a malha triangulada da última
     reconstrução (IndexedDB `wjflow`, registro `do-cad`) e abre o WJFlow com ela.
   - **STL ✅** (formato aberto, binário ou texto): para peças de fora; unidade escolhida no estudo.
   - **Orientação ✅:** o usuário escolhe a direção do ar nos eixos da peça (±X, ±Y, ±Z); a peça
     gira para o ar correr no +X do túnel.
2. **Voxelização ✅** (num Worker, em CPU: < 1 s para 1–2 M células): paridade de raios em X,
   um raio por coluna y-z, triângulos agrupados por coluna. A malha aberta aparece como "colunas
   com cruzamento ímpar" e gera um aviso. Na GPU só se a CPU ficar lenta em malhas maiores.
3. **Resolução recomendada** (o app sugere):
   - ≥ 60–100 células no comprimento do corpo;
   - ≥ 8–10 células na menor dimensão que importa (espessura do bordo, diâmetro do duto);
   - ≥ 16–20 células no diâmetro de tubos.
4. **Refinamento local** (malha multinível, fator 2 entre níveis, perto do corpo): é o maior ganho
   de qualidade por memória. Fica para A5, porque complica o kernel.

### 4.5 Precisão e memória

| Armazenamento | Bytes/célula (2 buffers + tipo) | Observação |
|---|---|---|
| FP32 | 153 | referência |
| **FP16** (conversão própria `meiaBits`, sem extensão) | **81** (10 palavras: pares de direções opostas) | populações deslocadas **× 2¹⁴** (`ESCALA_FP16`) e convertidas para FP16 com operações inteiras, ao par mais próximo. O `pack2x16float` da Adreno zera subnormais e **trunca**, e o erro se acumulava a cada passo. Diferença da referência ≈ 10⁻³ do valor; padrão em aparelhos fracos |
| FP16 + esquema *in-place* (Esoteric Pull, Lehmann 2022) | ~42 | um buffer só; A5 |

Memória × malha:

| Células | FP32 | FP16 |
|---|---|---|
| 1 M | 153 MB | 81 MB |
| 4 M | 612 MB | 324 MB |
| 8 M | 1,22 GB | 648 MB |

### 4.6 Resultados e pós-processamento

- **Planos de corte ✅** (velocidade, componente na direção do ar, Cp, vorticidade), em 2D ou
  dentro da vista 3D; falta tocar para ler o valor.
- **Vista 3D ✅** (Three.js, carregado só ao abrir; câmera ortográfica; giro, zoom e deslocamento
  como no WJCAD; vistas Iso, Lado, Cima e Frente):
  - **Cp na superfície** da peça (escala de −1 a +1): lê a primeira célula de fluido ao longo da
    normal de cada vértice;
  - **linhas de corrente 3D** (RK2 com interpolação trilinear; grade de 8², 12² ou 18² sementes
    antes da peça), coloridas pela velocidade;
  - **plano de corte** posicionado no túnel.
  - O campo (ux, uy, uz, δρ por célula, 16 B/célula) é copiado da GPU a cada ~4 s durante o
    cálculo e na hora ao pausar ou concluir; o pós-processamento roda num worker
    (`src/flow/campo.ts`, testado em Node).
  - Falta: sementes arrastáveis e isosuperfície do critério Q (A5).
- **Forças e coeficientes** (Cd, Cl, Cs, Cm) com histórico de convergência e **média temporal**
  (a partir da 2ª travessia).
- **Metas** (como em ferramentas de CFD profissionais): força, vazão, Δp entre duas faces,
  velocidade média numa seção, empuxo. O cálculo para quando as metas convergem (variação < 1 %
  em uma travessia).
- **Comparar versões:** o mesmo estudo em duas revisões da peça (WJPDM), lado a lado e em
  diferença percentual. Esse é o uso mais forte no tablet, porque o erro sistemático se cancela.
- **Exportar:** CSV para o WJPlan, imagens e tabela para o WJWrite, e VTK (formato aberto, para
  ParaView) no computador.

## 5. Viabilidade no aparelho do Johann

**Aparelho:** TCL Tab A1 Plus (6 GB). Pelas fichas técnicas:

| Item | Valor |
|---|---|
| SoC | Snapdragon 4 Gen 2 |
| GPU | Adreno 613 |
| RAM | LPDDR5 (≈ 25 GB/s teóricos) |

**Estimativa:**
- O LBM é limitado pela **largura de banda da memória**: cada célula lê e grava 19 populações por
  passo.
- O limite teórico fica entre ~165 MLUPS (FP32) e ~320 MLUPS (FP16).
- Na prática, uma GPU de entrada pelo WebGPU deve dar entre **20 e 80 MLUPS**.
- **O protótipo A0 existe para medir esse número.**

| Malha | Células | Uso | Com 40 MLUPS: 1 travessia |
|---|---|---|---|
| 128×64×64 | 0,5 M | rascunho rápido, celular | ~40 s |
| 160×80×80 | 1,0 M | **padrão do tablet** | ~80 s |
| 256×128×128 | 4,2 M | qualidade, computador | ~9 min |

**Riscos do aparelho:**
- **Driver fora da lista do Chrome:** o WebGPU no Android exige Android 12+ e uma GPU liberada.
  O Adreno 6xx costuma estar liberado. Se a autoverificação falhar ou não houver WebGPU, o plano B
  é LBM em WebGL2 (técnica conhecida: populações em texturas, fragment shader), mais lento ~2×.
  O plano C é CPU com WebAssembly SIMD multithread (~5–15 MLUPS).
- **Aquecimento:** o aparelho reduz o clock em cargas longas. O app mede os passos/s
  continuamente e mostra o tempo restante real.
- **Memória do navegador:** o Chrome no Android limita a memória de GPU por aba. O app consulta
  os limites (`maxBufferSize`) e não passa de ~40 % deles.

**Computador:**
- Uma GPU dedicada comum dá 500–3 000 MLUPS, o que permite malhas de 20–50 M células.
- O mesmo código roda nos três aparelhos; muda só a malha sugerida.

## 6. Interface (fluxo inspirado em ferramentas de CFD profissionais, sem copiar)

**Estrutura da tela:**
- **Árvore do estudo** à esquerda:
  1. Peça (vinculada à revisão do WJPDM)
  2. Fluido (ar: T, p, altitude)
  3. Domínio (túnel externo / interno)
  4. Contornos (entradas, saídas, paredes, solo móvel)
  5. Ventiladores (discos atuadores)
  6. Malha (resolução, regiões refinadas)
  7. Metas
  8. Resultados (planos, linhas, superfícies, gráficos)
- **Abas de comando:** Estudo · Contornos · Malha · Calcular · Resultados.
- **Painel de comando à esquerda** com ✓/✕ e campos rosa que recebem faces tocadas: por exemplo,
  "face de entrada" → tocar a boca do tubo.

**Assistentes por tipo de caso:**

| Assistente | O que o usuário informa | O que sai |
|---|---|---|
| Veículo | velocidade, solo móvel | Cd, Cl, área frontal automática |
| Asa/Aeronave | velocidade, α inicial–final–passo | polar CL×α, CD×CL, Cm |
| Tubulação | vazão ou Δp, rugosidade | Δp, K das singularidades, comparação com Moody |
| EDF | empuxo ou curva do ventilador, velocidade de voo | empuxo, V_e, potência, eficiência |

**Calcular:**
- O escoamento aparece **ao vivo** enquanto converge.
- Dá para pausar, mudar o plano de corte e continuar.
- A barra de status mostra passos/s, travessias, tempo restante e metas convergindo.

**Perfis:**
- **Celular:** malha de rascunho, resultados em gaveta.
- **Tablet:** caneta para posicionar planos e sementes.
- **Computador:** mouse dos CADs (meio gira, roda aproxima) e atalhos.

## 7. Validação (cada fase só é entregue com os casos dela passando)

| Caso | Referência | Tolerância no tablet | Status |
|---|---|---|---|
| Isotropia D3Q19, equilíbrio, opostas | exato | 10⁻¹² | ✅ `teste-flow` |
| Taylor–Green (decaimento viscoso) | exp(−2νk²t) | 1 % | ✅ |
| Poiseuille plano com força de Guo | perfil parabólico | 1 % (medido: 0,25 %) | ✅ |
| Conservação de massa (caixa fechada com obstáculo) | Σρ constante | 10⁻⁵ | ✅ |
| GPU × CPU (FP32 e FP16, LES e força) | referência `LbmCpu` | 10⁻⁵ / 10⁻² rel. | ✅ autoverificação no aparelho |
| Esfera, Re 100 | Cd ≈ 1,09 (Schiller–Naumann) | 10 % | A1 🟡: 1,26 (+15 %) com 15 células no diâmetro (§13) |
| Cilindro 2D, Re 20 e 100 | Schäfer–Turek 1996: Cd 5,58; St ≈ 0,30 | 5 % | A1 |
| Tubo turbulento | Moody/Haaland | 15 % | A2 |
| Expansão súbita | Borda–Carnot | 10 % | A2 |
| Disco atuador estático | teoria do momento | 5 % | A3 |
| Corpo de Ahmed 25° | Cd ≈ 0,29 (Ahmed 1984) | 20 % | A4 |
| Asa NACA 0012, AR finito | CL_α (linha sustentadora) | 10 % | A4 |
| Degrau descendente | recolamento ≈ 6–7 h | 15 % | A5 |

## 8. Formato `.wjflow` e integração

- JSON versionado: `{ versao, peca: { uri: "wj://pdm/<item>/<revisão>", malhaHash }, fluido, dominio, contornos, ventiladores, malha, metas, resultados: { resumo, historico } }`.
- Os campos de resultado 3D **não** vão no arquivo (seriam centenas de MB). O app guarda o
  resumo e a configuração e recalcula quando precisar.
- **Integrações:**
  - WJCAD: botão "Abrir no WJFlow" no menu Arquivo (A1). É um atalho de navegação; o WJCAD não
    ganha comandos de simulação.
  - WJPDM: estudo vinculado à revisão.
  - WJPlan: tabelas de resultado.
  - WJWrite: relatório.

## 9. Roteiro do WJFlow

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **A0** ✅ | Protótipo de medição: LBM D3Q19 em WebGPU (FP32/FP16, LES, força de Guo), autoverificação GPU × CPU, medição de MLUPS por malha, base em CPU, túnel ao vivo com esfera | autoverificação ok no TCL; números de desempenho anotados aqui |
| **A1** 🟡 | Túnel externo com a peça do WJCAD/STL ✅: voxelização ✅, saída ✅, esponja ✅, cortes (velocidade, componente na direção do ar, Cp, vorticidade; vista lateral e superior) ✅, forças por troca de momento ✅, Cd/Cl/Cs com média na última travessia ✅, `.wjflow` no cofre ✅, túnel padrão/amplo ✅. Falta: plano de simetria e validação do cilindro | esfera validada (§13); cilindro |
| **A2** | Escoamento interno: entradas e saídas em faces tocadas (vazão, velocidade, pressão), prolongamentos automáticos, Δp e K, comparação com Moody | tubo e expansão validados |
| **A3** | EDF: disco atuador por célula (empuxo, curva do ventilador ou C_T/C_P), giro opcional, empuxo/vazão/V_e/potência | disco estático validado |
| **A4** | Veículos e aeronaves: solo móvel, rodas girando, varredura de ângulo (polar), momentos, área frontal automática, correção de bloqueio | Ahmed e NACA 0012 validados |
| **A5** | Qualidade: colisão cumulante/regularizada, WALE, lei de parede, Bouzidi, malha multinível, esquema *in-place*, linhas de corrente 3D, critério Q, Cp na superfície | degrau descendente validado |
| **A6** | Servidor (junto com G5/G7): OpenFOAM (k-ω SST, snappyHexMesh) ou SU2 para números de projeto; o tablet configura e vê o resultado | caso do tablet × caso do servidor documentado |

## 10. Limites que o app sempre deixa visíveis

O app deixa claro o que não resolve:
- **Ar isotérmico:** sem troca de calor (aquecimento de motor, resfriamento de componentes).
  Pode entrar depois com uma população de temperatura (*double distribution*), se o Johann quiser.
- **M > 0,3:** o resultado perde validade. Isso afeta, por exemplo, a hélice ou o rotor do EDF
  resolvidos com as pás.
- **Camada limite não resolvida:** o atrito e a separação em superfícies lisas e arredondadas são
  aproximados. O app mostra o Re da célula e o y⁺ estimado.
- **Comparar é mais confiável que medir:** o erro absoluto típico é de 10–30 % em forças; a
  diferença entre duas versões é bem mais confiável.

## 11. Nome

**WJFlow**, definido pelo Johann em 28/10/2026. O nome anterior era WJAirFlow; "Airflow" é marca
da Apache Software Foundation.
- "Flow" é palavra genérica, e o risco de marca é baixo.
- Na UI, evitar nomes de produtos de CFD de terceiros (por exemplo, "Flow Simulation").

## 12. Referências técnicas (conceitos públicos; nenhum código de terceiros)

- Krüger, Kusumaatmaja, Kuzmin, Shardt, Silva, Viggen — *The Lattice Boltzmann Method:
  Principles and Practice*, Springer, 2017.
- Hou, Sterling, Chen, Doolen — LES com LBM (Smagorinsky), 1996.
- Guo, Zheng, Shi — termo de força discreto no LBM, *Phys. Rev. E* 65, 2002.
- Bouzidi, Firdaouss, Lallemand — bounce-back interpolado, *Phys. Fluids* 13, 2001.
- Latt, Chopard et al. — contornos regularizados, *Phys. Rev. E* 77, 2008.
- Geier, Schönherr, Pasquali, Krafczyk — LBM cumulante, *Comput. Math. Appl.* 70, 2015.
- Lehmann — FP16 e esquema Esoteric Pull no LBM em GPU, 2022 (só os conceitos; o código
  FluidX3D tem licença não comercial e **não** é usado).
- Schäfer, Turek — *Benchmark computations of laminar flow around a cylinder*, 1996.
- Ahmed, Ramm, Faltin — corpo de Ahmed, SAE 840300, 1984.
- White — *Fluid Mechanics*; Anderson — *Fundamentals of Aerodynamics*; Pope — *Turbulent Flows*.
- Colebrook (1939); Haaland (1983); Schiller–Naumann (1933).

## 13. Estado (28/10/2026)

- ✅ **A0 entregue:**
  - motor `src/flow/lbm.ts` (referência em CPU, unidades) com 26 verificações em `pnpm teste`;
  - solver WebGPU `src/flow/gpu.ts` (FP32/FP16, Smagorinsky, Guo; WGSL gerado com as
    direções desenroladas);
  - página `flow/` com autoverificação, medição, base em CPU e túnel ao vivo.
- Verificado no Chromium (GPU por software): GPU = CPU dentro de 2·10⁻⁸ (FP32) e 2·10⁻⁵ (FP16).
- **TCL Tab A1 Plus, 1ª rodada (28/10/2026):**
  - WebGPU ✓ (`qualcomm · adreno-6xx`), 128 MB por vínculo de buffer, `shader-f16` disponível.
  - **FP32 igual à referência** (diferença de 2·10⁻⁸).
  - **FP16 falhou** (3·10⁻⁴ e 1,8·10⁻⁴). A causa é que a Adreno zera números FP16 subnormais
    (*flush-to-zero*, permitido pelo WebGPU), e as populações deslocadas pequenas viravam zero.
  - O caso foi reproduzido em Node (`teste-flow`: com zeramento e sem escala dá exatamente o erro
    do tablet) e corrigido guardando f̃·2¹⁴.
  - O limite de 128 MB por vínculo restringe o FP32 a ≈ 1,7 M células (o FP16 a ≈ 3,5 M). A partir
    da A1, dividir as populações em vários buffers tira esse limite, se for preciso.
- **2ª rodada (28/10/2026):**
  - o canal passou com a escala;
  - a esfera ainda deu 2,05·10⁻⁴ (limite 1,2·10⁻⁴).
  - **Causa:** o `pack2x16float` da Adreno **trunca** em vez de arredondar ao mais próximo. A
    simulação em Node com truncagem dá exatamente os números do tablet (2,02·10⁻⁴ e 1,89·10⁻⁶).
  - **Correção:** conversão FP32→FP16 nossa, só com inteiros (`meiaBits`, igual ao padrão IEEE em
    1 milhão de valores no `teste-flow`). Com ela, o navegador dá 1,9·10⁻⁵ e 8·10⁻⁸.
- **3ª rodada (28/10/2026):** autoverificação ✓ nos quatro casos (FP16: 1,8·10⁻⁵ e 8·10⁻⁸).

  Desempenho do kernel 1 (duas células por thread, arrays):

  | Malha | FP32 | FP16 |
  |---|---|---|
  | 0,07–1,0 M células | **12,9 MLUPS** | **9,4 MLUPS** |
  | 1,77 M células | não cabe (128 MB por vínculo) | 9,4 MLUPS |

  A base em CPU deu 1,8 MLUPS por núcleo.

  **Diagnóstico:**
  - o FP16 ficou *mais lento* que o FP32, e a banda usada foi ~2 GB/s de ~25 possíveis;
  - logo, o limite é o cálculo e os registradores (arrays privados indo para a memória lenta),
    não a memória.

  **Kernel 2:**
  - uma célula por thread, despacho 3D;
  - escalares desenrolados, sem arrays;
  - equilíbrio na colisão e Π do Smagorinsky pelos momentos;
  - bit de vizinho sólido;
  - sólidos e EQ sem regravação;
  - força só quando o caso tem força;
  - a medição agora escolhe o tamanho de grupo (32/64/128) que rende mais no aparelho.

  Autoverificação ✓ no navegador. Na GPU simulada do servidor, o FP32 em 0,5 M células passou
  de 6,5 para ~11 MLUPS.
- **4ª rodada, kernel 2 no tablet (28/10/2026):**
  - autoverificação ✓ nos quatro casos;
  - grupo de 64 threads;
  - de **2,3 a 2,8× mais rápido** que o kernel 1.

  | Malha | Células | FP32 MLUPS | FP32: 1 travessia | FP16 MLUPS | FP16: 1 travessia |
  |---|---|---|---|---|---|
  | 128×64×64 | 0,52 M | 28,7 | 47 s | 26,3 | 51 s |
  | 160×80×80 | 1,02 M | **29,9** | **110 s** | 23,3 | 141 s |
  | 192×96×96 | 1,77 M | não cabe (128 MB por vínculo) | — | 26,9 | 253 s |

  A base em CPU dá 1,6 MLUPS por núcleo.

  **Leitura dos números:**
  - o FP32 é mais rápido e deve ser o padrão até ~1,7 M células;
  - o FP16 serve para malhas maiores;
  - a banda usada (~4,6 GB/s) ainda está longe do limite.
- **Malha padrão proposta para a A1 no tablet** (aguarda o Johann):

  | Modo | Células | Precisão | Tempo por resultado (3 travessias) |
  |---|---|---|---|
  | Rascunho | ~0,5 M | FP32 | ~2,5 min |
  | **Padrão** | ~1 M | FP32 | ~5,5 min |
  | Qualidade | ~1,7 M | FP16 | ~13 min |

  - O domínio é ajustado ao corpo (montante 1,5 L, jusante 4 L, bloqueio ≤ 5 %): com 1 M células,
    sobram ~35–45 células no comprimento do corpo.
  - O refinamento local (A5) é o que mais aumenta essa resolução. O Johann roda "Autoverificação" e "Medir
  desempenho" e cola o resultado ("Copiar resultados"). Esses números definem a malha padrão da A1.
- **A1 (28/10/2026):** túnel de vento com a peça do WJCAD/STL entregue (falta: plano de simetria e
  cilindro).
  - Autoverificação ampliada: a GPU confere com a CPU na saída, na esponja e na força por troca
    de momento (< 0,0001 % em FP32; < 0,04 % em FP16).
  - Em Node, a força nas paredes do canal iguala a força de corpo total (0,999997).
- **Validação da esfera em Re 100** (navegador, GPU simulada; mesmo cálculo que roda no tablet):

  | Túnel | Malha | Células no diâmetro | Cd | Diferença |
  |---|---|---|---|---|
  | Padrão (bloqueio 5 %) | 0,5 M | 16 | 1,32 | +21 % |
  | Amplo (bloqueio 2 %) | 1 M | 15 | 1,26 | +15 % |

  - A queda de 21 % para 15 % com quase a mesma resolução mostra que o confinamento pelas paredes
    do túnel pesa muito em Re baixo.
  - O que sobra vem da resolução (contorno em escada com 15 células) e do confinamento restante.
  - **Próximas verificações:**
    1. a mesma esfera no modo Qualidade (~18 células) deve baixar o Cd: é o teste de
       convergência, ~9 min no tablet;
    2. na A5, o bounce-back interpolado (Bouzidi) e o refinamento local atacam o erro de
       resolução.
  - Em Re alto (carros, aeronaves), o confinamento pesa menos, e o erro dominante passa a ser a
    camada limite não resolvida (§3.3).
- **Estabilidade em Re alto (peça exemplo do WJCAD, 80 mm a 20 m/s, Re ≈ 1,1·10⁵, 0,5 M células):**

  | Configuração | Cd |
  |---|---|
  | BGK puro | ruído em xadrez e oscilação de 1,2 a 2,8 (modo acústico de ¼ de onda) |
  | Regularizado + ω_b = 1 + camadas absorventes + partida suave | converge sem oscilar: **0,932** na média da última travessia (Cl −0,22) |

  - A esfera de validação foi calculada com o BGK. Repetir com a colisão nova no tablet leva
    ~4 min no modo Padrão + túnel amplo; o Cd deve ficar na mesma faixa, porque em Re 100 o τ é
    0,53 e os termos novos quase não agem.

