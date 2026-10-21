// Viewport 3D com Three.js. Gestos de toque:
//   1 dedo = orbitar · 2 dedos = pinça (zoom) + arrastar (pan) · toque duplo = enquadrar

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MalhaPeca } from "./kernel/regenerar";

export type Vista = "iso" | "frente" | "topo" | "direita";

export class Viewport {
  private renderer: THREE.WebGLRenderer;
  private cena = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controles: OrbitControls;
  private grupoPeca = new THREE.Group();
  private grade: THREE.GridHelper;
  private raioCena = 60;
  private precisaRender = true;

  private materialSolido = new THREE.MeshStandardMaterial({
    color: 0xb9c2cc,
    metalness: 0.15,
    roughness: 0.55,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  private materialArestas = new THREE.LineBasicMaterial({ color: 0x1b2128 });

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // poupa GPU do tablet
    container.appendChild(this.renderer.domElement);

    // CAD usa Z para cima
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    this.camera.up.set(0, 0, 1);

    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.12;
    this.controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controles.addEventListener("change", () => (this.precisaRender = true));

    this.cena.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sol = new THREE.DirectionalLight(0xffffff, 1.4);
    sol.position.set(1, -1.5, 2);
    this.camera.add(sol); // luz acompanha a câmera, a peça nunca fica no escuro
    this.cena.add(this.camera);

    this.grade = new THREE.GridHelper(200, 20, 0x5c6b7a, 0x34404c);
    this.grade.rotation.x = Math.PI / 2; // grade no plano XY
    this.cena.add(this.grade);
    this.cena.add(this.criarEixos());
    this.cena.add(this.grupoPeca);

    this.renderer.domElement.addEventListener("dblclick", () => this.enquadrar());
    new ResizeObserver(() => this.redimensionar()).observe(container);
    this.redimensionar();
    this.definirVista("iso", false);
    this.loop();
  }

  private criarEixos(): THREE.Group {
    const g = new THREE.Group();
    const cores = [0xe5484d, 0x46a758, 0x3e8ed0];
    const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    dirs.forEach((d, i) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), d.clone().multiplyScalar(20)]);
      g.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: cores[i] })));
    });
    return g;
  }

  mostrarMalha(m: MalhaPeca | null) {
    this.grupoPeca.children.forEach((o) => {
      (o as THREE.Mesh).geometry?.dispose();
    });
    this.grupoPeca.clear();
    if (m) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(m.normais, 3));
      geo.setIndex(new THREE.BufferAttribute(m.triangulos, 1));
      this.grupoPeca.add(new THREE.Mesh(geo, this.materialSolido));

      const geoA = new THREE.BufferGeometry();
      geoA.setAttribute("position", new THREE.BufferAttribute(m.arestas, 3));
      this.grupoPeca.add(new THREE.LineSegments(geoA, this.materialArestas));
    }
    this.precisaRender = true;
  }

  /** Ajusta a câmera para a peça caber na tela. */
  enquadrar(animado = true) {
    const caixa = new THREE.Box3().setFromObject(this.grupoPeca);
    const centro = new THREE.Vector3();
    if (caixa.isEmpty()) {
      this.raioCena = 60;
    } else {
      caixa.getCenter(centro);
      this.raioCena = Math.max(caixa.getSize(new THREE.Vector3()).length() / 2, 5);
    }
    const dir = this.camera.position.clone().sub(this.controles.target).normalize();
    const dist = this.raioCena / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.15;
    this.moverCamera(centro, centro.clone().add(dir.multiplyScalar(dist)), animado);
  }

  definirVista(v: Vista, animado = true) {
    const dirs: Record<Vista, THREE.Vector3> = {
      iso: new THREE.Vector3(1, -1, 0.8),
      frente: new THREE.Vector3(0, -1, 0.0001),
      topo: new THREE.Vector3(0, -0.0001, 1),
      direita: new THREE.Vector3(1, 0, 0.0001),
    };
    const alvo = this.controles.target.clone();
    const dist = Math.max(this.camera.position.distanceTo(alvo), 150);
    this.moverCamera(alvo, alvo.clone().add(dirs[v].normalize().multiplyScalar(dist)), animado);
  }

  private animacao: { de: [THREE.Vector3, THREE.Vector3]; para: [THREE.Vector3, THREE.Vector3]; t0: number } | null = null;

  private moverCamera(alvo: THREE.Vector3, posicao: THREE.Vector3, animado: boolean) {
    if (!animado) {
      this.controles.target.copy(alvo);
      this.camera.position.copy(posicao);
      this.controles.update();
      this.precisaRender = true;
      return;
    }
    this.animacao = {
      de: [this.controles.target.clone(), this.camera.position.clone()],
      para: [alvo, posicao],
      t0: performance.now(),
    };
  }

  private redimensionar() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.precisaRender = true;
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    if (this.animacao) {
      const t = Math.min((performance.now() - this.animacao.t0) / 350, 1);
      const k = 1 - Math.pow(1 - t, 3);
      this.controles.target.lerpVectors(this.animacao.de[0], this.animacao.para[0], k);
      this.camera.position.lerpVectors(this.animacao.de[1], this.animacao.para[1], k);
      if (t >= 1) this.animacao = null;
      this.precisaRender = true;
    }
    if (this.controles.update()) this.precisaRender = true;
    // Só desenha quando algo mudou: economiza bateria no tablet
    if (this.precisaRender) {
      this.renderer.render(this.cena, this.camera);
      this.precisaRender = false;
    }
  };
}
