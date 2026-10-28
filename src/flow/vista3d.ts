// WJFlow: vista 3D do túnel (Three.js, carregado só quando a vista 3D é aberta).
// Mostra a peça colorida pelo Cp na superfície, as linhas de corrente e o plano de corte, em
// coordenadas de célula (x = direção do ar, y para cima). Projeção ortográfica e tema claro, como
// no WJCAD; desenha só quando algo muda. Mouse: esquerdo ou meio giram, direito desloca, roda
// aproxima no cursor; toque: 1 dedo gira, 2 dedos aproximam e deslocam.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Malha } from "./geometria";
import type { RespostaPos } from "./pos-worker";

export interface Camadas {
  cp: boolean;
  linhas: boolean;
  plano: boolean;
}

export class Vista3D {
  private renderer: THREE.WebGLRenderer;
  private cena = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private controles: OrbitControls;
  private peca?: THREE.Mesh;
  private linhas?: THREE.LineSegments;
  private plano?: THREE.Mesh;
  private caixa?: THREE.LineSegments;
  private seta?: THREE.ArrowHelper;
  private dims: [number, number, number] = [1, 1, 1];
  private observador: ResizeObserver;
  private quadro = 0;
  camadas: Camadas = { cp: true, linhas: true, plano: true };

  constructor(private alvo: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0xf4f6f8);
    alvo.append(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5);
    this.cena.add(new THREE.HemisphereLight(0xffffff, 0xb9c2cc, 1.6));
    const sol = new THREE.DirectionalLight(0xffffff, 1.4);
    sol.position.set(1, 2, 1.5);
    this.camera.add(sol); // a luz acompanha a câmera: a face vista fica sempre iluminada
    this.cena.add(this.camera);
    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.zoomToCursor = true;
    this.controles.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controles.addEventListener("change", () => this.desenhar());
    this.observador = new ResizeObserver(() => this.ajustarTamanho());
    this.observador.observe(alvo);
    this.ajustarTamanho();
  }

  /** Peça (em células) e túnel nx × ny × nz; enquadra a câmera na peça, em vista isométrica. */
  definirGeometria(malha: Malha, nx: number, ny: number, nz: number) {
    this.dims = [nx, ny, nz];
    for (const o of [this.peca, this.caixa, this.seta, this.linhas, this.plano]) if (o) this.cena.remove(o);
    this.linhas = this.plano = undefined;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(malha.vertices, 3));
    g.setIndex(new THREE.BufferAttribute(malha.triangulos, 1));
    g.computeVertexNormals();
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(malha.vertices.length).fill(0.62), 3));
    this.peca = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.cena.add(this.peca);
    // túnel (arestas) e a direção do ar
    const caixa = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(nx - 0.5, ny - 0.5, nz - 0.5));
    this.caixa = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(nx, ny, nz)), new THREE.LineBasicMaterial({ color: 0xb9c2cc }));
    this.caixa.position.copy(caixa.getCenter(new THREE.Vector3()));
    this.cena.add(this.caixa);
    this.seta = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-0.5, ny * 0.85, nz / 2), nx * 0.12, 0x2f7fd0, nx * 0.03, nx * 0.02);
    this.cena.add(this.seta);
    // enquadra a peça (com a esteira próxima)
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const centro = bb.getCenter(new THREE.Vector3());
    const tam = bb.getSize(new THREE.Vector3());
    const raio = Math.max(tam.x * 0.9, tam.y * 1.2, tam.z * 1.2, 8);
    centro.x += tam.x * 0.3;
    this.controles.target.copy(centro);
    this.camera.position.copy(centro).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(raio * 4));
    this.camera.zoom = 1;
    this.alcance = raio;
    this.ajustarTamanho();
    this.controles.update();
  }
  private alcance = 10;

  /** Aplica o resultado do pós-processamento (cores da peça, linhas, plano de corte). */
  atualizar(r: RespostaPos, corte: { plano: 0 | 1; indice: number }) {
    if (!this.peca) return;
    const cor = this.peca.geometry.getAttribute("color") as THREE.BufferAttribute;
    if (cor.array.length === r.coresPeca.length) {
      (cor.array as Float32Array).set(r.coresPeca);
      cor.needsUpdate = true;
    }
    this.coresCp = r.coresPeca;
    if (this.linhas) {
      this.cena.remove(this.linhas);
      this.linhas.geometry.dispose();
    }
    const gl = new THREE.BufferGeometry();
    gl.setAttribute("position", new THREE.BufferAttribute(r.linhas, 3));
    gl.setAttribute("color", new THREE.BufferAttribute(r.coresLinhas, 3));
    this.linhas = new THREE.LineSegments(gl, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.cena.add(this.linhas);
    this.definirPlano(r.imagem, corte);
    this.aplicarCamadas();
  }
  private coresCp?: Float32Array;

  private definirPlano(img: RespostaPos["imagem"], corte: { plano: 0 | 1; indice: number }) {
    if (this.plano) {
      this.cena.remove(this.plano);
      this.plano.geometry.dispose();
      ((this.plano.material as THREE.MeshBasicMaterial).map as THREE.Texture | null)?.dispose();
    }
    const { largura: w, altura: h } = img;
    // plano 0: linha 0 da imagem é o maior y; a textura começa embaixo → inverte as linhas
    let rgba = img.rgba;
    if (corte.plano === 0) {
      rgba = new Uint8Array(img.rgba.length);
      for (let r = 0; r < h; r++) rgba.set(img.rgba.subarray(4 * w * r, 4 * w * (r + 1)), 4 * w * (h - 1 - r));
    }
    const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const [nx, ny, nz] = this.dims;
    const geo = new THREE.PlaneGeometry(nx, corte.plano === 0 ? ny : nz);
    this.plano = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false }));
    if (corte.plano === 0) this.plano.position.set(nx / 2 - 0.5, ny / 2 - 0.5, corte.indice);
    else {
      this.plano.rotation.x = Math.PI / 2; // y local → +z: a linha 0 da imagem (z = 0) fica no z = 0
      this.plano.position.set(nx / 2 - 0.5, corte.indice, nz / 2 - 0.5);
    }
    this.cena.add(this.plano);
  }

  /** Liga/desliga as camadas e redesenha. */
  aplicarCamadas() {
    if (this.peca) {
      const cor = this.peca.geometry.getAttribute("color") as THREE.BufferAttribute;
      const arr = cor.array as Float32Array;
      if (this.camadas.cp && this.coresCp && arr.length === this.coresCp.length) arr.set(this.coresCp);
      else arr.fill(0.62);
      cor.needsUpdate = true;
    }
    if (this.linhas) this.linhas.visible = this.camadas.linhas;
    if (this.plano) this.plano.visible = this.camadas.plano;
    this.desenhar();
  }

  /** Vistas padrão (no sistema do túnel). */
  vista(nome: "iso" | "lado" | "cima" | "frente") {
    const d = { iso: [1, 0.8, 1.2], lado: [0, 0, 1], cima: [0, 1, 0.0001], frente: [-1, 0, 0] }[nome];
    const alvo = this.controles.target.clone();
    this.camera.position.copy(alvo).add(new THREE.Vector3(...(d as [number, number, number])).normalize().multiplyScalar(this.alcance * 4));
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controles.update();
  }

  private ajustarTamanho() {
    const w = Math.max(1, this.alvo.clientWidth), h = Math.max(1, this.alvo.clientHeight);
    this.renderer.setSize(w, h, false);
    const a = this.alcance * 1.1, asp = w / h;
    Object.assign(this.camera, { left: -a * asp, right: a * asp, top: a, bottom: -a });
    this.camera.updateProjectionMatrix();
    this.desenhar();
  }

  desenhar() {
    if (this.quadro) return;
    this.quadro = requestAnimationFrame(() => {
      this.quadro = 0;
      this.renderer.render(this.cena, this.camera);
    });
  }

  destruir() {
    this.observador.disconnect();
    this.controles.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
