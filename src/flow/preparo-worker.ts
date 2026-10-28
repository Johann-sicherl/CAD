// WJFlow: prepara o túnel (orientação, escala, voxelização) fora da thread da interface.
import { preparar, type Estudo } from "./estudo";
import type { Malha } from "./geometria";

self.onmessage = (e: MessageEvent<{ estudo: Estudo; malha: Malha }>) => {
  try {
    const p = preparar(e.data.estudo, e.data.malha);
    postMessage({ preparo: p }, { transfer: [p.dominio.tipo.buffer, p.malhaTunel.vertices.buffer] });
  } catch (x) {
    postMessage({ erro: (x as Error).message });
  }
};
