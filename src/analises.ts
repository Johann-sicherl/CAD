// Análises visuais da aba Avaliar, calculadas sobre a malha da peça (sem o kernel):
// inclinação (moldagem), curvatura, espessura e listras zebra. Ver docs/funcional/avaliar.md.

import * as THREE from "three";

export type Analise =
  | { tipo: "inclinacao"; direcao: [number, number, number]; angulo: number }
  | { tipo: "curvatura" }
  | { tipo: "espessura"; alvo: number }
  | { tipo: "zebra"; listras: number };

const VERDE = new THREE.Color(0x3fa45b);
const VERMELHO = new THREE.Color(0xd9443f);
const AMARELO = new THREE.Color(0xf2c230);
const CINZA = new THREE.Color(0xc9d1da);

/** Cor por vértice: positiva ≥ ângulo (verde), negativa (vermelho), precisa de inclinação (amarelo). */
export function coresInclinacao(geo: THREE.BufferGeometry, dir: THREE.Vector3, anguloGraus: number): Float32Array {
  const n = geo.getAttribute("normal") as THREE.BufferAttribute;
  const out = new Float32Array(n.count * 3);
  const lim = Math.sin((anguloGraus * Math.PI) / 180);
  const v = new THREE.Vector3();
  const d = dir.clone().normalize();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i);
    const s = v.dot(d); // seno do ângulo de inclinação em relação à direção de extração
    const c = s >= lim ? VERDE : s <= -lim ? VERMELHO : AMARELO;
    out.set([c.r, c.g, c.b], i * 3);
  }
  return out;
}

/** Curvatura aproximada: variação da normal entre vértices vizinhos dividida pela distância. */
export function coresCurvatura(geo: THREE.BufferGeometry): { cores: Float32Array; maxima: number } {
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  const n = geo.getAttribute("normal") as THREE.BufferAttribute;
  const idx = geo.getIndex()!;
  const soma = new Float32Array(p.count), cont = new Uint16Array(p.count);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), na = new THREE.Vector3(), nb = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    for (let k = 0; k < 3; k++) {
      const i = idx.getX(t + k), j = idx.getX(t + ((k + 1) % 3));
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, j);
      na.fromBufferAttribute(n, i); nb.fromBufferAttribute(n, j);
      const d = a.distanceTo(b);
      if (d < 1e-9) continue;
      const k1 = na.angleTo(nb) / d;
      soma[i] += k1; soma[j] += k1; cont[i]++; cont[j]++;
    }
  }
  let maxima = 0;
  const kv = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    kv[i] = cont[i] ? soma[i] / cont[i] : 0;
    maxima = Math.max(maxima, kv[i]);
  }
  const out = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = maxima > 0 ? Math.min(1, kv[i] / maxima) : 0;
    c.setHSL(0.66 * (1 - t), 0.75, 0.5); // azul (plano) → vermelho (mais curvo)
    out.set([c.r, c.g, c.b], i * 3);
  }
  return { cores: out, maxima };
}

/** Espessura: raio para dentro (contra a normal) em cada vértice; abaixo do alvo = vermelho. */
export function coresEspessura(malha: THREE.Mesh, alvo: number): { cores: Float32Array; minima: number } {
  const geo = malha.geometry;
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  const n = geo.getAttribute("normal") as THREE.BufferAttribute;
  const ray = new THREE.Raycaster();
  const o = new THREE.Vector3(), d = new THREE.Vector3();
  const lado = (malha.material as THREE.Material).side;
  (malha.material as THREE.Material).side = THREE.DoubleSide;
  const out = new Float32Array(p.count * 3);
  let minima = Infinity;
  const c = new THREE.Color();
  // amostra no máximo ~4000 vértices; os demais copiam o vizinho anterior (tablet)
  const passo = Math.max(1, Math.ceil(p.count / 4000));
  let ultima = CINZA.clone();
  for (let i = 0; i < p.count; i++) {
    if (i % passo === 0) {
      o.fromBufferAttribute(p, i);
      d.fromBufferAttribute(n, i).negate();
      ray.set(o.addScaledVector(d, 1e-3), d);
      const hit = ray.intersectObject(malha, false)[0];
      if (hit) {
        const t = hit.distance;
        minima = Math.min(minima, t);
        const r = Math.min(1, t / (alvo * 2));
        c.setHSL(0.33 * r, 0.8, 0.48); // vermelho (fino) → verde (≥ 2× alvo)
        ultima = c.clone();
      } else ultima = CINZA.clone();
    }
    out.set([ultima.r, ultima.g, ultima.b], i * 3);
  }
  (malha.material as THREE.Material).side = lado;
  return { cores: out, minima };
}

/** Material de listras zebra: reflexo do ambiente listrado, revela descontinuidades entre faces. */
export function materialZebra(listras: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { listras: { value: listras } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float listras; varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 r = reflect(-vV, normalize(vN));
        float s = step(0.5, fract(r.y * listras));
        gl_FragColor = vec4(vec3(mix(0.08, 0.97, s)), 1.0);
      }`,
  });
}
