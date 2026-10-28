// WJAirFlow: base de desempenho em CPU (uma thread, JavaScript), para comparar com a GPU e
// estimar o caminho sem WebGPU. Roda fora da thread da interface.
import { LbmCpu, tunelEsfera } from "./lbm";

self.onmessage = (e: MessageEvent<{ nx: number; ny: number; nz: number; ms: number }>) => {
  const { nx, ny, nz, ms } = e.data;
  const s = new LbmCpu({ nx, ny, nz, tau: 0.53, cs: 0.1, u: [0.05, 0, 0] }, tunelEsfera(nx, ny, nz, ny / 4));
  s.passo();
  const t0 = performance.now();
  let passos = 0;
  while (performance.now() - t0 < ms) {
    s.passo();
    passos++;
  }
  const t = (performance.now() - t0) / 1000;
  postMessage({ celulas: s.n, passos, segundos: t, mlups: (s.n * passos) / t / 1e6 });
};
