// Teste da montagem (src/montagem): transformações, peças embutidas e instâncias, exclusão,
// quantidades, cena junta (malhas e topologia de vários componentes) e mapa de entidades.
import { documentoExemplo, type Documento } from "../src/model";
import {
  aplicarDirecao, aplicarPonto, compor, embutirPeca, excluirComponentes, girarEmTorno, IDENTIDADE, inserirComponente, inverter, marcaDe, matriz,
  montagemVazia, quantidades, quatDeEuler, quatEixoAngulo, rotuloComponente, validarMontagem, type Transformacao,
} from "../src/montagem/modelo";
import { centroDoComponente, facesDoComponente, globalDaEntidade, juntar, localDaEntidade } from "../src/montagem/cena";
import { resolverMontagem, tiposPossiveis, primitivaLocal, transformar, compRel } from "../src/montagem/solver";
import type { Referencia, Vec3 } from "../src/model";
import type { MalhaPeca } from "../src/kernel/regenerar";
import type { Topologia } from "../src/kernel/topologia";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${JSON.stringify(obtido)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}
const r3 = (v: number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);

// ---------- transformações ----------
const q90z = quatEixoAngulo([0, 0, 1], 90);
igual("girar 90° em Z leva X em Y", r3(aplicarDirecao({ pos: [0, 0, 0], rot: q90z }, [1, 0, 0])), [0, 1, 0]);
const t: Transformacao = { pos: [10, 0, 5], rot: q90z };
igual("ponto: gira e translada", r3(aplicarPonto(t, [1, 0, 0])), [10, 1, 5]);
igual("inversa desfaz", r3(aplicarPonto(compor(inverter(t), t), [3, -2, 7])), [3, -2, 7]);
igual("compor = aplicar em sequência", r3(aplicarPonto(compor(t, t), [1, 0, 0])), r3(aplicarPonto(t, aplicarPonto(t, [1, 0, 0]))));
igual("euler (0,0,90) = 90° em Z", r3(aplicarDirecao({ pos: [0, 0, 0], rot: quatDeEuler(0, 0, 90) }, [1, 0, 0])), [0, 1, 0]);
igual("euler X depois Y", r3(aplicarDirecao({ pos: [0, 0, 0], rot: quatDeEuler(90, 90, 0) }, [0, 1, 0])), [1, 0, 0]);
igual("girar em torno do centro (10,0,0)", r3(girarEmTorno(IDENTIDADE(), q90z, [10, 0, 0]).pos), [10, -10, 0]);
const M = matriz(t);
igual("matriz (colunas) aplica igual", r3([M[0] * 1 + M[12], M[1] * 1 + M[13], M[2] * 1 + M[14]]), [10, 1, 5]);

// ---------- documento ----------
const d = montagemVazia("Conjunto");
const peca: Documento = documentoExemplo();
const p1 = embutirPeca(d, peca, { arquivo: "arqA", versao: 1, nome: "Suporte.wjcad" });
const p1b = embutirPeca(d, peca, { arquivo: "arqA", versao: 1 });
igual("mesmo arquivo do cofre é embutido uma vez", [p1 === p1b, d.pecas.length, d.pecas[0].nome], [true, 1, "Suporte"]);
const outra: Documento = { ...documentoExemplo(), nome: "Suporte" };
outra.features = outra.features.slice(0, 1);
const p2 = embutirPeca(d, outra, {});
igual("arquivo diferente com o mesmo nome ganha (2)", d.pecas.find((p) => p.id === p2)?.nome, "Suporte (2)");
const c1 = inserirComponente(d, p1, { pos: [50, 0, 0], rot: [0, 0, 0, 1] });
const c2 = inserirComponente(d, p1, { pos: [100, 0, 0], rot: [0, 0, 0, 1] });
const c3 = inserirComponente(d, p2, { pos: [0, 80, 0], rot: [0, 0, 0, 1] });
igual("primeiro fixo na origem", [c1.fixo, c1.t.pos, c2.fixo], [true, [0, 0, 0], false]);
igual("instâncias numeradas", [rotuloComponente(d, c1), rotuloComponente(d, c2), rotuloComponente(d, c3)], ["Suporte<1>", "Suporte<2>", "Suporte (2)<1>"]);
igual("quantidades", quantidades(d).map((x) => [x.peca.nome, x.qtd]), [["Suporte", 2], ["Suporte (2)", 1]]);
// conteúdo novo do mesmo arquivo do cofre atualiza a peça embutida
const mudada = { ...documentoExemplo(), nome: "Suporte" };
mudada.features[0] = { ...mudada.features[0], nome: "Base nova" } as never;
embutirPeca(d, mudada, { arquivo: "arqA", versao: 2 });
igual("versão nova do cofre substitui a embutida", [d.pecas[0].versao, d.pecas[0].doc.features[0].nome], [2, "Base nova"]);
d.posicionamentos.push({ id: "m1", nome: "Coincidente1", tipo: "coincidente", alinhamento: "auto", a: { comp: c2.id, ref: { tipo: "plano", id: "XY" } }, b: { comp: null, ref: { tipo: "plano", id: "XY" } } });
excluirComponentes(d, [c3.id, c2.id]);
igual("excluir leva os posicionamentos e a peça sem uso", [d.componentes.length, d.posicionamentos.length, d.pecas.length], [1, 0, 1]);
const c4 = inserirComponente(d, p1);
igual("instância nova continua a numeração (não reaproveita)", rotuloComponente(d, c4), "Suporte<2>");
igual("validar: peça ausente tira o componente", validarMontagem(JSON.parse(JSON.stringify({ ...d, pecas: [] }))).componentes.length, 0);
igual("marca muda com o conteúdo", marcaDe("a") !== marcaDe("b"), true);

// ---------- cena junta ----------
// cubo de 1 face/2 triângulos simplificado: 4 vértices, 2 triângulos, 1 face, 1 aresta (2 pontos)
const malha = (): MalhaPeca => ({
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  normais: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  triangulos: new Uint32Array([0, 1, 2, 0, 2, 3]),
  arestas: new Float32Array([0, 0, 0, 1, 0, 0]),
  faces: new Uint32Array([0, 6, 0]),
  gruposArestas: new Uint32Array([0, 2]),
});
const topo = (): Topologia => ({
  faces: [{ geom: "plano", centro: [0.5, 0.5, 0], area: 1, normal: [0, 0, 1] }],
  arestas: [{ geom: "linha", meio: [0.5, 0, 0], a: [0, 0, 0], b: [1, 0, 0], comprimento: 1 }],
  vertices: [[0, 0, 0], [1, 0, 0]],
  arestasDaFace: [[0]],
});
const cena = juntar([
  { comp: "A", malha: malha(), topo: topo(), t: IDENTIDADE() },
  { comp: "B", malha: malha(), topo: topo(), t: { pos: [10, 0, 0], rot: quatEixoAngulo([1, 0, 0], 180) } },
]);
igual("vértices juntos (B transladado)", r3(Array.from(cena.malha.vertices.slice(12, 15))), [10, 0, 0]);
igual("triângulos de B deslocados", Array.from(cena.malha.triangulos.slice(6)), [4, 5, 6, 4, 6, 7]);
igual("faces: início em triângulos e id deslocados", Array.from(cena.malha.faces), [0, 6, 0, 6, 6, 1]);
igual("grupos de arestas deslocados", Array.from(cena.malha.gruposArestas), [0, 2, 2, 2]);
igual("normal de B girada 180° em X", r3(cena.topo.faces[1].normal!), [0, 0, -1]);
igual("arestas da face deslocadas", cena.topo.arestasDaFace, [[0], [1]]);
igual("entidade da cena → componente local", [localDaEntidade(cena.mapa, "face", 1), localDaEntidade(cena.mapa, "vertice", 2)], [{ comp: "B", indice: 0 }, { comp: "B", indice: 0 }]);
igual("faces do componente", facesDoComponente(cena.mapa, "B"), [1]);
igual("local → cena", globalDaEntidade(cena.mapa, "aresta", "B", 0), 1);
igual("centro do componente B", r3(centroDoComponente(cena, "B")!), [10.5, 0, 0]);

// ---------- solver dos posicionamentos ----------
{
  // cubo 10×10×10 de 0 a 10: faces planas pelas assinaturas
  const face = (centro: Vec3, normal: Vec3): Referencia => ({ tipo: "face", ass: { geom: "plano", centro, area: 100, normal } });
  const F = {
    topo: face([5, 10, 5], [0, 1, 0]), base: face([5, 0, 5], [0, -1, 0]), esq: face([0, 5, 5], [-1, 0, 0]),
    dir: face([10, 5, 5], [1, 0, 0]), frente: face([5, 5, 10], [0, 0, 1]), tras: face([5, 5, 0], [0, 0, -1]),
  };
  const furo: Referencia = { tipo: "face", ass: { geom: "cilindro", centro: [5, 5, 5], area: 50, eixo: [0, 1, 0], pontoEixo: [5, 0, 5], raio: 2 } };
  const montar = () => {
    const m = montagemVazia();
    const p = embutirPeca(m, documentoExemplo(), { nome: "Cubo" });
    const A = inserirComponente(m, p);
    const B = inserirComponente(m, p, { pos: [30, 7, -4], rot: quatDeEuler(10, 20, 5) });
    return { m, A, B };
  };
  const mate = (id: string, tipo: Parameters<typeof tiposPossiveis>[0] extends never ? never : string, a: [string | null, Referencia], b: [string | null, Referencia], alinhamento: "alinhado" | "antialinhado" | "auto", valor?: number) =>
    ({ id, nome: id, tipo: tipo as never, a: { comp: a[0], ref: a[1] }, b: { comp: b[0], ref: b[1] }, alinhamento, valor });
  const aplicar = (m: ReturnType<typeof montar>["m"], r: ReturnType<typeof resolverMontagem>) => { for (const [id, t] of r.poses) m.componentes.find((c) => c.id === id)!.t = t; };

  // 1 posicionamento: B apoiado no topo de A — sobram 3 graus (2 deslizes + giro na normal)
  {
    const { m, A, B } = montar();
    m.posicionamentos.push(mate("c1", "coincidente", [B.id, F.base], [A.id, F.topo], "antialinhado"));
    const r = resolverMontagem(m);
    aplicar(m, r);
    const base = transformar(primitivaLocal(F.base)!, B.t);
    igual("B apoiado: base de B na altura 10, normal para baixo", [Math.round((base as { p: Vec3 }).p[1] * 1e4) / 1e4, r3((base as { n: Vec3 }).n)], [10, [0, -1, 0]]);
    igual("sobram 3 graus de liberdade", [r.graus.get(B.id), r.erros.size], [3, 0]);
  }
  // 3 coincidentes: B exatamente em cima de A, totalmente definido
  {
    const { m, A, B } = montar();
    m.posicionamentos.push(
      mate("c1", "coincidente", [B.id, F.base], [A.id, F.topo], "antialinhado"),
      mate("c2", "coincidente", [B.id, F.esq], [A.id, F.esq], "alinhado"),
      mate("c3", "coincidente", [B.id, F.tras], [A.id, F.tras], "alinhado"),
    );
    const r = resolverMontagem(m);
    aplicar(m, r);
    igual("três coincidentes: B em (0,10,0) sem giro", [r3(B.t.pos), r3(aplicarDirecao(B.t, [1, 0, 0]))], [[0, 10, 0], [1, 0, 0]]);
    igual("totalmente definido", r.graus.get(B.id), 0);
    // conflito: distância de 5 entre as mesmas faces já coincidentes
    m.posicionamentos.push(mate("d1", "distancia", [B.id, F.base], [A.id, F.topo], "antialinhado", 5));
    const r2 = resolverMontagem(m);
    igual("conflito é avisado", r2.erros.size > 0, true);
  }
  // distância e plano da montagem (comp null)
  {
    const { m, A, B } = montar();
    void A;
    m.posicionamentos.push(mate("d1", "distancia", [null, { tipo: "plano", id: "XZ" }], [B.id, F.base], "antialinhado", 25));
    const r = resolverMontagem(m);
    aplicar(m, r);
    const base = transformar(primitivaLocal(F.base)!, B.t) as { p: Vec3; n: Vec3 };
    igual("distância 25 do plano Superior", Math.round(base.p[1] * 1e4) / 1e4, 25);
  }
  // concêntrico entre os furos e paralelo: eixos alinhados
  {
    const { m, A, B } = montar();
    m.posicionamentos.push(mate("k1", "concentrico", [B.id, furo], [A.id, furo], "auto"));
    const r = resolverMontagem(m);
    aplicar(m, r);
    const ea = transformar(primitivaLocal(furo)!, A.t) as { p: Vec3; d: Vec3 }, eb = transformar(primitivaLocal(furo)!, B.t) as { p: Vec3; d: Vec3 };
    const dist = Math.hypot(eb.p[0] - ea.p[0], eb.p[2] - ea.p[2]);
    igual("concêntrico: eixos na mesma reta", [Math.round(dist * 1e4) / 1e4, Math.abs(Math.round(eb.d[1] * 1e4) / 1e4)], [0, 1]);
    igual("concêntrico deixa 2 graus (desliza e gira no eixo)", r.graus.get(B.id), 2);
  }
  // ângulo de 90° entre faces
  {
    const { m, A, B } = montar();
    m.posicionamentos.push(mate("a1", "angulo", [B.id, F.frente], [A.id, F.frente], "alinhado", 90));
    const r = resolverMontagem(m);
    aplicar(m, r);
    const na = transformar(primitivaLocal(F.frente)!, A.t) as { n: Vec3 }, nb = transformar(primitivaLocal(F.frente)!, B.t) as { n: Vec3 };
    igual("ângulo de 90°", Math.round((na.n[0] * nb.n[0] + na.n[1] * nb.n[1] + na.n[2] * nb.n[2]) * 1e4) / 1e4 + 0, 0);
  }
  // travar: B mantém a posição relativa a A mesmo com A flutuante
  {
    const { m, A, B } = montar();
    A.fixo = false;
    const rel = compRel(A.t, B.t);
    m.posicionamentos.push({ ...mate("t1", "travar", [A.id, F.topo], [B.id, F.base], "auto"), rel });
    m.posicionamentos.push(mate("c1", "coincidente", [A.id, F.base], [null, { tipo: "plano", id: "XZ" }], "antialinhado"));
    const r = resolverMontagem(m);
    aplicar(m, r);
    igual("travar: posição relativa mantida", r3(compRel(A.t, B.t).pos), r3(rel.pos));
  }
  // move o mínimo: apoiar uma peça deslocada só sobe (não gira nem escorrega nos graus livres)
  {
    const m = montagemVazia();
    const p = embutirPeca(m, documentoExemplo(), {});
    const A = inserirComponente(m, p);
    const B = inserirComponente(m, p, { pos: [73.4, 0, 0], rot: [0, 0, 0, 1] });
    m.posicionamentos.push(mate("c1", "coincidente", [B.id, face([0, 0, 0], [0, -1, 0])], [A.id, face([0, 10, 0], [0, 1, 0])], "antialinhado"));
    const r = resolverMontagem(m, { centros: new Map([[A.id, [0, 5, 0] as Vec3], [B.id, [73.4, 15, 0] as Vec3]]), escala: 80 });
    aplicar(m, r);
    igual("só sobe 10 mm, sem girar nem escorregar", [r3(B.t.pos).map((x) => Math.round(x * 100) / 100), r3(B.t.rot)], [[73.4, 10, 0], [0, 0, 0, 1]]);
  }
  igual("tipos possíveis plano-plano", tiposPossiveis(primitivaLocal(F.topo)!, primitivaLocal(F.base)!).slice(0, 3), ["coincidente", "paralelo", "perpendicular"]);
  igual("tipo sugerido face plana + cilindro", tiposPossiveis(primitivaLocal(F.topo)!, primitivaLocal(furo)!)[0], "tangente");
  igual("tipo sugerido cilindro + cilindro", tiposPossiveis(primitivaLocal(furo)!, primitivaLocal(furo)!)[0], "concentrico");
}

console.log(falhas ? `\nmontagem: ${falhas} falha(s)` : "\nmontagem: tudo certo");
if (falhas) process.exit(1);
