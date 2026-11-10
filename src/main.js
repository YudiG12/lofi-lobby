import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { ligarRadioAoServidor, receberComando } from "./radio.js";

// ---- Config dos assets (troque aqui pra usar outros arquivos) ----
const CIDADE = {
  fbx: "/assets/cidade/source/mdl_FBX_TwinLeafTown.fbx",
  textura: "/assets/cidade/textures/PNG_Twinleaf-Atlas.png",
};
// Sprite sheet do personagem: bloco de 4x4 quadros no canto superior esquerdo.
// Cada quadro tem 32px com 2px de borda. Linhas = direções, colunas = passos.
// Um sheet por gênero. null = treinador original gerado em pixel art;
// ou o caminho de um sprite sheet com o mesmo layout (4x4, 32px, borda 2px).
const SHEETS = {
  masculino: "/assets/personagens/male-character.png",
  feminino: "/assets/personagens/female-character.png",
};
let GENERO = "masculino";
try {
  GENERO =
    localStorage.getItem("genero") === "feminino" ? "feminino" : "masculino";
} catch {}
// sheets configurados que não carregaram (arquivo ausente): usa o original
const sheetsFalhos = new Set();
const sheetDisponivel = (g) => !!SHEETS[g] && !sheetsFalhos.has(g);

// Layout dos treinadores originais (grade 4x4)
const GRADE = {
  layout: "grade",
  quadro: 32,
  borda: 2,
  origem: [2, 2],
  linhas: { baixo: 0, cima: 1, esquerda: 2, direita: 3 },
  passos: 4,
};
// Recorte de cada sheet configurado. Dois layouts:
//  - "grade":   linhas = direções, colunas = passos (como o GRADE acima)
//  - "fileira": tudo numa linha só; cada direção ocupa `passos` quadros
//               seguidos, na ordem dada por `linhas` (0 = primeiro bloco)
// quadro = largura do quadro (px) · altura = altura (px, se diferente)
// borda = espaço entre quadros · origem = [x, y] do canto do 1º quadro
const RECORTE = {
  masculino: {
    layout: "fileira",
    quadro: 32,
    borda: 3,
    origem: [17, 30],
    linhas: { baixo: 0, esquerda: 3, cima: 2, direita: 1 },
    passos: 3,
  },
  feminino: { ...GRADE },
};
const RECORTE_CORRIDA = {
  masculino: { ...RECORTE.masculino, origem: [17, 100] },
  feminino: { ...GRADE, origem: [172, 2] },
};
const PERSONAGEM = {
  get sheet() {
    return SHEETS[GENERO];
  },
  get cfg() {
    return sheetDisponivel(GENERO) ? RECORTE[GENERO] : GRADE;
  },
  get layout() {
    return this.cfg.layout;
  },
  get quadro() {
    return this.cfg.quadro;
  },
  get altura() {
    return this.cfg.altura || this.cfg.quadro;
  },
  get borda() {
    return this.cfg.borda;
  },
  get origem() {
    return this.cfg.origem;
  },
  get linhas() {
    return this.cfg.linhas;
  },
  get passos() {
    return this.cfg.passos;
  },
};
// posição (x, y) do quadro no sheet, pra qualquer layout
function posQuadro(cfg, dir, passo) {
  const [ox, oy] = cfg.origem;
  const w = cfg.quadro,
    h = cfg.altura || cfg.quadro,
    b = cfg.borda;
  if (cfg.layout === "fileira") {
    const i = cfg.linhas[dir] * cfg.passos + passo;
    return { x: ox + i * (w + b), y: oy, w, h };
  }
  return { x: ox + passo * (w + b), y: oy + cfg.linhas[dir] * (h + b), w, h };
}

// ---- Cena ----
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#070a18");
scene.fog = new THREE.Fog("#070a18", 50, 140);

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);

// Noite: luar azulado fraco; os postes são a luz principal
scene.add(new THREE.HemisphereLight("#3a4a8a", "#0b0f1a", 0.35));
const sol = new THREE.DirectionalLight("#7f95d8", 0.45); // lua
sol.position.set(40, 80, 30);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
Object.assign(sol.shadow.camera, {
  left: -80,
  right: 80,
  top: 80,
  bottom: -80,
  far: 300,
});
scene.add(sol);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---- Cidade (FBX) ----
const texLoader = new THREE.TextureLoader();
const atlas = texLoader.load(CIDADE.textura);
atlas.magFilter = THREE.NearestFilter;
atlas.minFilter = THREE.NearestFilter;
atlas.colorSpace = THREE.SRGBColorSpace;

let cidadeBox = new THREE.Box3(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 0, 50),
);
// ---- Água animada ----
// Phong normal + shader injetado: ondinhas que perturbam a normal (o brilho dos
// postes e da lua "dança" na superfície), faixas de luz se movendo e cintilação.
const uniAgua = { uTempo: { value: 0 } };
const matAgua = new THREE.MeshPhongMaterial({
  // noite: azul profundo, sem luz própria; o brilho vem só dos postes (e um fio de lua)
  color: "#0b2d63", // azul profundo, menos saturado
  emissive: "#020c22", // só um fio de azul próprio pra não virar preto
  specular: "#7a6440", // reflexo quente, fino (só onde a luz do poste bate)
  shininess: 160,
  transparent: true,
  opacity: 0.92,
  side: THREE.DoubleSide,
});
matAgua.onBeforeCompile = (shader) => {
  shader.uniforms.uTempo = uniAgua.uTempo;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vMundo;")
    .replace(
      "#include <worldpos_vertex>",
      "#include <worldpos_vertex>\nvMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
uniform float uTempo;
varying vec3 vMundo;
float onda(vec2 p, vec2 d, float f, float v) { return sin(dot(p, d) * f + uTempo * v); }`,
    )
    // perturba a normal com ondas em várias direções
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
vec2 pa = vMundo.xz * 1.6; // tamanho das ondas: maior = mais finas
float dx = onda(pa, vec2(1.0, 0.3), 1.7, 1.6) * 0.5 + onda(pa, vec2(-0.4, 1.0), 2.9, 2.3) * 0.3 + onda(pa, vec2(0.7, -0.8), 5.3, 3.1) * 0.15;
float dz = onda(pa, vec2(0.2, 1.0), 2.1, 1.4) * 0.5 + onda(pa, vec2(1.0, -0.5), 3.7, 2.7) * 0.3 + onda(pa, vec2(-0.9, -0.6), 6.1, 3.5) * 0.15;
normal = normalize(normal + vec3(dx, 0.0, dz) * 0.18);`,
    )
    // faixas de luz e cintilação somadas à cor final
    .replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>
float faixa = smoothstep(0.75, 1.0, onda(vMundo.xz, vec2(0.6, 0.8), 0.9, 0.8) * onda(vMundo.xz, vec2(-0.8, 0.5), 1.3, 1.1));
float brilho = pow(max(0.0, onda(vMundo.xz, vec2(1.0, 0.2), 7.0, 4.0) * onda(vMundo.xz, vec2(-0.3, 1.0), 6.0, 3.3)), 12.0);
gl_FragColor.rgb += vec3(0.10, 0.25, 0.6) * faixa * 0.06 + vec3(0.7, 0.8, 1.0) * brilho * 0.07;`,
    );
};

// O FBX referencia a textura num caminho absoluto do Windows: redireciona pro atlas local.
const manager = new THREE.LoadingManager();
manager.setURLModifier((url) =>
  /\.(png|jpg|tga)$/i.test(url) && !url.startsWith("/assets")
    ? CIDADE.textura
    : url,
);
// Prepara qualquer cidade (FBX local ou a vila original): escala, colisão, postes.
function prepararCidade(fbx) {
    // normaliza escala: cidade com ~100 unidades de largura
    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    const s = 100 / Math.max(size.x, size.z);
    fbx.scale.setScalar(s);
    const box2 = new THREE.Box3().setFromObject(fbx);
    const c = box2.getCenter(new THREE.Vector3());
    fbx.position.x -= c.x;
    fbx.position.z -= c.z;
    fbx.position.y -= box2.min.y;
    cidadeBox = new THREE.Box3().setFromObject(fbx);
    scene.add(fbx);
    cidadeMeshes = [];
    fbx.traverse((o) => o.isMesh && cidadeMeshes.push(o));
    calcularLagoBox();
    fbx.traverse((o) => {
      if (o.isMesh && /mailbox|sign|fence/i.test(o.name))
        caixasSolidas.push(new THREE.Box3().setFromObject(o));
    });
    acomodarPares();
}

// ---- Vila original (padrão do site publicado) ----
// Tudo feito no código, sem asset externo: grama, estrada de terra em cruz,
// casas com telhado, cercas, caixas de correio, árvores e um lago com borda.
// Os nomes das malhas seguem as mesmas convenções da colisão (Water, PondEdge,
// Fence, Mailbox), então água, borda e objetos sólidos funcionam igual.
function criarVilaOriginal() {
  const vila = new THREE.Group();
  vila.name = "VilaOriginal";
  const mat = (cor) => new THREE.MeshLambertMaterial({ color: cor, flatShading: true });
  const add = (geo, m, x, y, z, nome = "", pai = vila) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.name = nome;
    mesh.castShadow = mesh.receiveShadow = true;
    pai.add(mesh);
    return mesh;
  };
  const M = {
    grama: mat("#4f9a3a"), terra: mat("#c8a46a"), parede: mat("#e6d3b0"), parede2: mat("#d9c29a"),
    telhadoA: mat("#2f6f5a"), telhadoB: mat("#8a3b2e"), porta: mat("#6b4428"), janela: mat("#3a4f7a"),
    madeira: mat("#8a5a34"), tronco: mat("#5a3a22"), folha: mat("#2e6b34"), folha2: mat("#3d8040"),
    pedra: mat("#7d7a74"), correio: mat("#c0503a"), fundo: mat("#3a5a7a"),
  };

  // chão e estrada (cruz centrada em x=0)
  add(new THREE.BoxGeometry(110, 1, 110), M.grama, 0, -0.5, 0, "Ground");
  add(new THREE.BoxGeometry(7, 0.12, 110), M.terra, 0, 0.06, 0, "Ground_Path");
  add(new THREE.BoxGeometry(80, 0.12, 6), M.terra, 0, 0.06, -6, "Ground_Path");

  // casas: corpo + telhado de 4 águas + porta e janelas viradas pra estrada
  const casa = (x, z, w, d, h, telhado, viradaPara) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    vila.add(g);
    add(new THREE.BoxGeometry(w, h, d), viradaPara > 0 ? M.parede : M.parede2, 0, h / 2, 0, "House", g);
    const teto = add(new THREE.ConeGeometry(Math.max(w, d) * 0.78, h * 0.7, 4), telhado, 0, h + h * 0.35, 0, "House_Roof", g);
    teto.rotation.y = Math.PI / 4;
    teto.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    const f = viradaPara * (w / 2 + 0.05); // lado da fachada (eixo x)
    const porta = add(new THREE.BoxGeometry(0.1, 2.4, 1.4), M.porta, f, 1.2, 0, "House", g);
    porta.castShadow = false;
    for (const dz of [-d / 3.2, d / 3.2]) add(new THREE.BoxGeometry(0.1, 1.1, 1.2), M.janela, f, h * 0.62, dz, "House", g);
    // caixa de correio na frente da casa
    add(new THREE.BoxGeometry(0.6, 0.6, 0.9), M.correio, f + viradaPara * 2.2, 1.1, d / 2 - 0.5, "Mailbox", g);
    add(new THREE.BoxGeometry(0.15, 0.8, 0.15), M.madeira, f + viradaPara * 2.2, 0.4, d / 2 - 0.5, "Mailbox", g);
  };
  casa(-14, -22, 12, 10, 5, M.telhadoA, 1);
  casa(14, -22, 12, 10, 5, M.telhadoB, -1);
  casa(-14, 10, 10, 9, 4.5, M.telhadoB, 1);
  casa(14, 10, 14, 10, 6, M.telhadoA, -1);

  // cercas baixas ao fundo
  for (let x = -40; x <= 40; x += 2.5) {
    if (Math.abs(x) < 5) continue; // abertura da estrada
    add(new THREE.BoxGeometry(0.25, 1.2, 0.25), M.madeira, x, 0.6, -40, "Fence");
  }
  add(new THREE.BoxGeometry(35, 0.2, 0.15), M.madeira, -22.5, 0.9, -40, "Fence");
  add(new THREE.BoxGeometry(35, 0.2, 0.15), M.madeira, 22.5, 0.9, -40, "Fence");

  // árvores (pinheiros low-poly) nas bordas
  const arvore = (x, z, s = 1) => {
    add(new THREE.CylinderGeometry(0.3 * s, 0.4 * s, 1.6 * s, 6), M.tronco, x, 0.8 * s, z, "Tree");
    add(new THREE.ConeGeometry(2 * s, 3.6 * s, 7), M.folha, x, 3.2 * s, z, "Tree");
    add(new THREE.ConeGeometry(1.5 * s, 2.8 * s, 7), M.folha2, x, 4.8 * s, z, "Tree");
  };
  for (let i = 0; i < 16; i++) {
    const lado = i % 2 ? 1 : -1;
    arvore(lado * (42 + (i % 3) * 3), -45 + i * 6, 1 + (i % 3) * 0.15);
  }
  for (const [x, z] of [[-30, 30], [30, 32], [-36, -10], [36, -12], [-26, 46], [28, 48]]) arvore(x, z, 1.2);

  // lago com borda de pedra, embaixo da estrada
  const lago = new THREE.Group();
  lago.position.set(0, 0, 34);
  vila.add(lago);
  const borda = new THREE.Group();
  borda.name = "PondEdge";
  lago.add(borda);
  add(new THREE.BoxGeometry(26, 0.5, 14), M.fundo, 0, -0.6, 0, "PondBed", lago);
  for (let x = -13; x <= 13; x += 2) {
    add(new THREE.BoxGeometry(2, 0.6, 1), M.pedra, x, 0.3, -7, "PondEdge", borda);
    add(new THREE.BoxGeometry(2, 0.6, 1), M.pedra, x, 0.3, 7, "PondEdge", borda);
  }
  for (let z = -6; z <= 6; z += 2) {
    add(new THREE.BoxGeometry(1, 0.6, 2), M.pedra, -13, 0.3, z, "PondEdge", borda);
    add(new THREE.BoxGeometry(1, 0.6, 2), M.pedra, 13, 0.3, z, "PondEdge", borda);
  }
  const agua = new THREE.Group();
  agua.name = "PondWater";
  lago.add(agua);
  const sup = add(new THREE.PlaneGeometry(25, 13, 1, 1), matAgua, 0, 0.05, 0, "Water", agua);
  sup.rotation.x = -Math.PI / 2;
  sup.castShadow = false;

  // registra água e borda pro sistema de colisão
  vila.traverse((o) => {
    if (!o.isMesh) return;
    if (o.parent === borda) bordaMeshes.add(o);
    if (o.parent === agua) aguaMeshes.add(o);
  });
  return vila;
}

// Sem os arquivos locais da cidade, monta uma vila original em low-poly.
function carregarVilaOriginal() {
  document.querySelector("#local b").textContent = "Lofi Lobby";
  prepararCidade(criarVilaOriginal());
}

new FBXLoader(manager).load(
  CIDADE.fbx,
  (fbx) => {
    fbx.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      o.material = mats.map(
        (m) =>
          new THREE.MeshLambertMaterial({
            map: atlas,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
          }),
      );
      if (o.material.length === 1) o.material = o.material[0];
      // superfície da água: azul translúcido, levemente brilhante, e bloqueia passagem
      // o nome da água pode estar na malha ou num grupo pai (ex.: MainTownPondWater)
      let nomeAgua = "";
      for (let p = o; p; p = p.parent)
        if (/water/i.test(p.name)) {
          nomeAgua = p.name;
          break;
        }
      // borda do lago (pedras irregulares): vira parede reta, ninguém pisa nela
      for (let p = o; p; p = p.parent)
        if (/pond.*edge|edge.*pond/i.test(p.name)) {
          bordaMeshes.add(o);
          break;
        }
      if (nomeAgua && !/bed|edge/i.test(nomeAgua)) {
        o.material = matAgua;
        o.castShadow = false;
        aguaMeshes.add(o);
      }
    });
    prepararCidade(fbx);
  },
  undefined,
  () => carregarVilaOriginal(), // arquivo local não existe (ex.: site publicado)
);

// ---- Postes de luz (modelo original, low-poly) ----
const matFerro = new THREE.MeshLambertMaterial({
  color: "#2f3b45",
  flatShading: true,
});
const matLuz = new THREE.MeshBasicMaterial({ color: "#ffdf7a" });
const texBrilho = (() => {
  const cv = Object.assign(document.createElement("canvas"), {
    width: 64,
    height: 64,
  });
  const ctx = cv.getContext("2d");
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
function criarPoste(x, z) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1, 0.7, 6),
    matFerro,
  );
  base.position.y = 0.35;
  const haste = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.36, 7, 6),
    matFerro,
  );
  haste.position.y = 4;
  const braco = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.28, 0.28),
    matFerro,
  );
  braco.position.y = 7.4;
  const lanterna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.6, 1.4, 4),
    matLuz,
  );
  lanterna.position.y = 8.2;
  lanterna.rotation.y = Math.PI / 4;
  const chapeu = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.8, 4), matFerro);
  chapeu.position.y = 9.3;
  chapeu.rotation.y = Math.PI / 4;
  // só base e haste fazem sombra; a parte de cima envolve a lâmpada e escureceria tudo
  [base, haste].forEach((m) => (m.castShadow = true));
  const luz = new THREE.PointLight("#ffc95a", 150, 22, 1.6); // ~2700K, amarelo quente
  luz.position.set(0.9, 7.6, 0); // um pouco pra fora da haste, sob o braço
  luz.castShadow = true;
  luz.shadow.mapSize.set(1024, 1024);
  luz.shadow.bias = -0.0005;
  luz.shadow.normalBias = 0.05;
  luz.shadow.radius = 4;
  const brilho = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texBrilho,
      color: "#ffd45e",
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  brilho.scale.set(6, 6, 1);
  brilho.position.y = 8.2;
  g.add(brilho);
  g.add(base, haste, braco, lanterna, chapeu, luz);
  g.position.set(x, 0, z);
  scene.add(g);
  return g;
}
// posições ao longo dos caminhos (ajuste à vontade)
const POSTES = [
  [-6, -14],
  [6, -14],
  [-6, 24],
  [6, 24],
];
const postes = POSTES.map(([x, z]) => criarPoste(x, z));
const solidosPostes = postes.flatMap((p) => p.children.filter((c) => c.isMesh));

let cidadeMeshes = [];
const aguaMeshes = new Set();
const bordaMeshes = new Set();
const caixasSolidas = [];
// margem extra na frente (lado da câmera, +z) e nas laterais: o sprite é
// largo e fica em pé, então "invade" o objeto antes de os pés encostarem
function dentroDeSolido(x, z, r, frente = r * 2) {
  return caixasSolidas.some(
    (b) =>
      x > b.min.x - r * 1.3 &&
      x < b.max.x + r * 1.3 &&
      z > b.min.z - r &&
      z < b.max.z + frente,
  );
}
// Caixa reta em volta do lago inteiro (borda + água): colisão limpa, sem degraus
let lagoBox = null;
function calcularLagoBox() {
  const todos = [...aguaMeshes, ...bordaMeshes];
  if (!todos.length) return;
  lagoBox = new THREE.Box3();
  todos.forEach((m) => lagoBox.expandByObject(m));
}
function noLago(x, z) {
  return (
    !!lagoBox &&
    x > lagoBox.min.x &&
    x < lagoBox.max.x &&
    z > lagoBox.min.z &&
    z < lagoBox.max.z
  );
}
function ehAgua(x, z) {
  if (!aguaMeshes.size) return false;
  raio.set(new THREE.Vector3(x, 200, z), BAIXO);
  const hits = raio.intersectObjects(cidadeMeshes, false);
  return (
    hits.length > 0 &&
    (aguaMeshes.has(hits[0].object) || bordaMeshes.has(hits[0].object))
  );
}
const raio = new THREE.Raycaster();
const BAIXO = new THREE.Vector3(0, -1, 0);
// Altura da superfície mais alta naquele ponto (chão, ou topo de casa/árvore/cerca)
function alturaTopo(x, z) {
  if (!cidadeMeshes.length) return 0;
  raio.set(new THREE.Vector3(x, 200, z), BAIXO);
  // ignora as pedras da borda do lago: elas são parede, não chão
  const hits = raio
    .intersectObjects(cidadeMeshes, false)
    .filter((h) => !bordaMeshes.has(h.object));
  return hits.length ? hits[0].point.y : 0;
}
// Altura do chão: superfície mais baixa (ignora telhados em cima)
function alturaChao(x, z) {
  if (!cidadeMeshes.length) return 0;
  raio.set(new THREE.Vector3(x, 200, z), BAIXO);
  const hits = raio.intersectObjects(cidadeMeshes, false);
  return hits.length ? hits[hits.length - 1].point.y : 0;
}

// Um ponto é "aberto" se o chão é plano num raio r (nada alto por perto)
function aberto(x, z, r) {
  // poste não fica colado em caixa de correio/placa/cerca nem no lago
  if (dentroDeSolido(x, z, r + 1.5) || noLago(x, z)) return false;
  const y = alturaChao(x, z);
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    for (const d of [0, r * 0.5, r]) {
      const px = x + Math.cos(ang) * d,
        pz = z + Math.sin(ang) * d;
      if (Math.abs(alturaTopo(px, pz) - y) > 0.4) return false;
    }
  }
  return true;
}
// Move o poste pro ponto aberto mais próximo (busca em espiral)
// Postes em pares espelhados nas laterais da estrada de terra principal:
// mesmo z pros dois lados, mesma distância do centro. Se um ponto não estiver
// livre, o PAR inteiro desliza junto ao longo da estrada (só no eixo z).
const CENTRO_ESTRADA_X = 0;
const AFASTAMENTO = 4.6; // distância ideal do centro da estrada até cada poste (na grama, rente à terra)
const AFASTAMENTO_MIN = 3.8; // o mais perto que pode chegar (beira da terra)
function acomodarPares() {
  for (let i = 0; i < postes.length; i += 2) {
    const a = postes[i],
      b = postes[i + 1];
    const z0 = a.position.z;
    // primeiro tenta aproximar da estrada (sai de baixo de beirais de telhado);
    // só desliza ao longo da estrada se nem perto dela couber
    const cabe = (af, z) =>
      aberto(CENTRO_ESTRADA_X - af, z, 2.4) &&
      (!b || aberto(CENTRO_ESTRADA_X + af, z, 2.4));
    let zOk = z0,
      afOk = AFASTAMENTO;
    busca: for (let d = 0; d <= 16; d += 0.5) {
      for (const z of [z0 + d, z0 - d]) {
        for (let af = AFASTAMENTO; af >= AFASTAMENTO_MIN; af -= 0.25) {
          if (cabe(af, z)) {
            zOk = z;
            afOk = af;
            break busca;
          }
        }
      }
    }
    a.position.set(
      CENTRO_ESTRADA_X - afOk,
      alturaChao(CENTRO_ESTRADA_X - afOk, zOk),
      zOk,
    );
    if (b)
      b.position.set(
        CENTRO_ESTRADA_X + afOk,
        alturaChao(CENTRO_ESTRADA_X + afOk, zOk),
        zOk,
      );
  }
}
function acomodarPoste(p) {
  const x0 = p.position.x,
    z0 = p.position.z;
  for (let r = 0; r <= 20; r += 0.75) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const x = x0 + Math.cos(ang) * r,
        z = z0 + Math.sin(ang) * r;
      if (
        aberto(x, z, 2.2) &&
        postes.every(
          (o) => o === p || Math.hypot(o.position.x - x, o.position.z - z) > 4,
        )
      ) {
        p.position.set(x, alturaChao(x, z), z);
        return;
      }
    }
  }
}

// ---- Colisão ----
const RAIO_CORPO = 0.9; // "largura" do personagem
const DEGRAU_MAX = 1.2; // diferença de altura que ele consegue subir
const RAIO_POSTE = 1.1;
function livre(x, z, yAtual) {
  if (
    x < cidadeBox.min.x ||
    x > cidadeBox.max.x ||
    z < cidadeBox.min.z ||
    z > cidadeBox.max.z
  )
    return false;
  if (dentroDeSolido(x, z, RAIO_CORPO * 0.8, RAIO_CORPO * 1.6)) return false;
  // lago: caixa reta (com a largura do corpo), sem seguir as pedras irregulares
  if (
    noLago(x - RAIO_CORPO, z) ||
    noLago(x + RAIO_CORPO, z) ||
    noLago(x, z - RAIO_CORPO) ||
    noLago(x, z + RAIO_CORPO)
  )
    return false;
  for (const p of postes)
    if (
      Math.hypot(p.position.x - x, p.position.z - z) <
      RAIO_POSTE + RAIO_CORPO * 0.5
    )
      return false;
  // testa o centro e 4 pontos em volta do corpo
  const pts = [
    [0, 0],
    [RAIO_CORPO, 0],
    [-RAIO_CORPO, 0],
    [0, RAIO_CORPO],
    [0, -RAIO_CORPO],
  ];
  return pts.every(
    ([ox, oz]) =>
      alturaTopo(x + ox, z + oz) - yAtual <= DEGRAU_MAX &&
      !ehAgua(x + ox, z + oz),
  );
}

// ---- Personagem (sprite billboard) ----
// Sem sheet configurado, usa um treinador original gerado em pixel art.
function criarTexturaPersonagem(genero) {
  const caminho = sheetDisponivel(genero) ? SHEETS[genero] : null;
  if (caminho) {
    const t = texLoader.load(
      caminho,
      (t) => {
        t.magFilter = t.minFilter = THREE.NearestFilter;
        t.colorSpace = THREE.SRGBColorSpace;
        removeFundo(t);
      },
      undefined,
      () => {
        // arquivo local não existe (ex.: site publicado): cai pro treinador original
        sheetsFalhos.add(genero);
        if (genero === GENERO) aplicarGenero(GENERO);
      },
    );
    return t;
  }
  const t = new THREE.CanvasTexture(gerarTreinadorOriginal(genero));
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  queueMicrotask(() => setQuadro("baixo", 0));
  return t;
}
let sheetTex = criarTexturaPersonagem(GENERO);

// Troca o gênero do meu personagem (textura nova nos 3 materiais)
function aplicarGenero(genero) {
  GENERO = genero === "feminino" ? "feminino" : "masculino";
  try {
    localStorage.setItem("genero", GENERO);
  } catch {}
  const antiga = sheetTex;
  sheetTex = criarTexturaPersonagem(GENERO);
  sprite.material.map = sheetTex;
  sprite.customDepthMaterial.map = sheetTex;
  sprite.customDistanceMaterial.map = sheetTex;
  [
    sprite.material,
    sprite.customDepthMaterial,
    sprite.customDistanceMaterial,
  ].forEach((m) => (m.needsUpdate = true));
  antiga.dispose();
  if (typeof ws !== "undefined" && ws?.readyState === 1)
    ws.send(JSON.stringify({ t: "genero", genero: GENERO }));
}
window.aplicarGenero = aplicarGenero; // usado pela tela de entrada

// Trocar no meio do jogo: botão no HUD ou tecla G (fora do chat)
const alternarGenero = () =>
  aplicarGenero(GENERO === "feminino" ? "masculino" : "feminino");
document.querySelector("#trocar-genero").addEventListener("click", (e) => {
  alternarGenero();
  e.currentTarget.blur(); // devolve o teclado pro jogo
});
addEventListener("keydown", (e) => {
  const digitando = ["INPUT", "TEXTAREA"].includes(
    document.activeElement?.tagName,
  );
  if (!digitando && !e.repeat && e.key.toLowerCase() === "g") alternarGenero();
});

// Treinadores originais, mesmo layout do sheet configurável
// (4 direções x 4 passos, quadros de 32px, borda 2px).
// masculino: boné verde, jaqueta laranja, mochila roxa.
// feminino: gorro coral, cabelo comprido, casaco azul-petróleo, saia, bolsa amarela.
function gerarTreinadorOriginal(genero = "masculino") {
  const fem = genero === "feminino";
  const {
    quadro: Q,
    borda: B,
    origem: [ox, oy],
  } = GRADE;
  const cv = Object.assign(document.createElement("canvas"), {
    width: ox + 4 * (Q + B),
    height: oy + 4 * (Q + B),
  });
  const c = cv.getContext("2d");
  const P = 2; // 1 "pixel" do personagem = 2px no quadro (16x16 lógico)
  const px = (x0, y0, x, y, w, h, cor) => {
    c.fillStyle = cor;
    c.fillRect(x0 + x * P, y0 + y * P, w * P, h * P);
  };
  const COR = fem
    ? {
        pele: "#f4caa6",
        cabelo: "#5a3524",
        bone: "#ef6f5e",
        aba: "#c24f40",
        jaqueta: "#2f8f9d",
        jaq2: "#226b76",
        calca: "#33334a",
        tenis: "#f4f4f4",
        mochila: "#f2c14e",
        olho: "#1b1b24",
        contorno: "#1b1b24",
      }
    : {
        pele: "#f2c29a",
        cabelo: "#3b2a20",
        bone: "#2f9e6b",
        aba: "#1f6e4a",
        jaqueta: "#f08a3c",
        jaq2: "#c96524",
        calca: "#2c3550",
        tenis: "#f4f4f4",
        mochila: "#6b4fa3",
        olho: "#1b1b24",
        contorno: "#1b1b24",
      };
  const dirs = ["baixo", "cima", "esquerda", "direita"];
  dirs.forEach((dir, lin) => {
    for (let passo = 0; passo < 4; passo++) {
      const x0 = ox + passo * (Q + B),
        y0 = oy + lin * (Q + B);
      const bob = passo % 2 ? 1 : 0; // sobe e desce ao andar
      const perna = passo === 1 ? 1 : passo === 3 ? -1 : 0;
      const y = (v) => v - bob;
      // pernas e tênis
      px(x0, y0, 5, y(12), 2, 2 + (perna > 0 ? 1 : 0), COR.calca);
      px(x0, y0, 9, y(12), 2, 2 + (perna < 0 ? 1 : 0), COR.calca);
      px(x0, y0, 5, y(14 + (perna > 0 ? 1 : 0)), 2, 1, COR.tenis);
      px(x0, y0, 9, y(14 + (perna < 0 ? 1 : 0)), 2, 1, COR.tenis);
      // corpo
      px(x0, y0, 4, y(7), 8, 5, COR.jaqueta);
      px(x0, y0, 4, y(11), 8, 1, COR.jaq2);
      if (dir === "cima") px(x0, y0, 5, y(7), 6, 4, COR.mochila);
      if (dir === "esquerda") px(x0, y0, 10, y(7), 2, 4, COR.mochila);
      if (dir === "direita") px(x0, y0, 4, y(7), 2, 4, COR.mochila);
      // braços
      if (dir === "baixo" || dir === "cima") {
        px(x0, y0, 3, y(8), 1, 3, COR.pele);
        px(x0, y0, 12, y(8), 1, 3, COR.pele);
      }
      // cabeça
      px(x0, y0, 4, y(2), 8, 5, dir === "cima" ? COR.cabelo : COR.pele);
      px(x0, y0, 4, y(1), 8, 2, COR.bone);
      if (dir === "baixo") {
        px(x0, y0, 4, y(3), 8, 1, COR.aba);
        px(x0, y0, 6, y(4), 1, 1, COR.olho);
        px(x0, y0, 9, y(4), 1, 1, COR.olho);
      }
      if (dir === "esquerda") {
        px(x0, y0, 2, y(3), 4, 1, COR.aba);
        px(x0, y0, 5, y(4), 1, 1, COR.olho);
        px(x0, y0, 9, y(2), 3, 4, COR.cabelo);
      }
      if (dir === "direita") {
        px(x0, y0, 10, y(3), 4, 1, COR.aba);
        px(x0, y0, 10, y(4), 1, 1, COR.olho);
        px(x0, y0, 4, y(2), 3, 4, COR.cabelo);
      }
      if (fem) {
        // cabelo comprido caindo pelos ombros + saia por cima da calça
        if (dir === "baixo") {
          px(x0, y0, 3, y(3), 1, 6, COR.cabelo);
          px(x0, y0, 12, y(3), 1, 6, COR.cabelo);
        }
        if (dir === "cima") px(x0, y0, 4, y(4), 8, 5, COR.cabelo);
        if (dir === "esquerda") px(x0, y0, 9, y(5), 3, 4, COR.cabelo);
        if (dir === "direita") px(x0, y0, 4, y(5), 3, 4, COR.cabelo);
        px(x0, y0, 4, y(11), 8, 2, COR.jaq2);
      }
    }
  });
  return cv;
}
// Plano "billboard" iluminado: recebe a luz dos postes e projeta sombra
// com o recorte do sprite (alphaTest também nos materiais de profundidade).
const geoPersonagem = new THREE.PlaneGeometry(1, 1);
geoPersonagem.translate(0, 0.45, 0); // pés perto da origem
const sprite = new THREE.Mesh(
  geoPersonagem,
  new THREE.MeshLambertMaterial({
    map: sheetTex,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  }),
);
sprite.customDepthMaterial = new THREE.MeshDepthMaterial({
  map: sheetTex,
  alphaTest: 0.5,
  depthPacking: THREE.RGBADepthPacking,
});
sprite.customDistanceMaterial = new THREE.MeshDistanceMaterial({
  map: sheetTex,
  alphaTest: 0.5,
});
sprite.castShadow = true;
sprite.receiveShadow = false;
sprite.scale.set(5, 5, 1);
scene.add(sprite);

// sombra de contato bem leve, só pra "assentar" os pés no chão
const sombra = new THREE.Mesh(
  new THREE.CircleGeometry(0.7, 16),
  new THREE.MeshBasicMaterial({
    map: texBrilho,
    color: 0,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  }),
);
sombra.rotation.x = -Math.PI / 2;
scene.add(sombra);

// Troca a cor de fundo do sheet (pixel 0,0 de cada quadro) por transparente
function removeFundo(t) {
  const img = t.image;
  const cv = Object.assign(document.createElement("canvas"), {
    width: img.width,
    height: img.height,
  });
  const ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  const [ox, oy] = PERSONAGEM.origem;
  const i0 = (oy * cv.width + ox) * 4;
  const bg = [d.data[i0], d.data[i0 + 1], d.data[i0 + 2]];
  for (let i = 0; i < d.data.length; i += 4) {
    if (
      Math.abs(d.data[i] - bg[0]) < 8 &&
      Math.abs(d.data[i + 1] - bg[1]) < 8 &&
      Math.abs(d.data[i + 2] - bg[2]) < 8
    )
      d.data[i + 3] = 0;
  }
  ctx.putImageData(d, 0, 0);
  t.image = cv;
  t.needsUpdate = true;
  setQuadro("baixo", 0);
}

function setQuadro(dir, passo, correndo = false) {
  const img = sheetTex.image;
  if (!img || !img.width) return;
  const cfg = correndo && SHEETS[GENERO] ? RECORTE_CORRIDA[GENERO] : PERSONAGEM.cfg;
  const { x, y, w, h } = posQuadro(cfg, dir, passo);
  sheetTex.repeat.set(w / img.width, h / img.height);
  sheetTex.offset.set(x / img.width, 1 - (y + h) / img.height);
}

// ---- Oclusão estilo 2.5D ----
// Decide pela posição dos pés: se nada está entre a câmera e os pés,
// o sprite inteiro é desenhado na frente de tudo (sem cortar o corpo
// em paredes/telhados atrás dele). Se algo está na frente, oculta normal.
// Todos os pixels do sprite usam a profundidade dos PÉS (um pouco à frente):
// o que está na frente dos pés cobre o corpo inteiro; o que está atrás nunca corta.
sprite.renderOrder = 10;
const uniPes = { uPes: { value: new THREE.Vector3() } };
sprite.material.depthTest = true;
sprite.material.depthWrite = true;
sprite.material.onBeforeCompile = (shader) => {
  shader.uniforms.uPes = uniPes.uPes;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nuniform vec3 uPes;")
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
vec4 pesClip = projectionMatrix * viewMatrix * vec4(uPes, 1.0);
gl_Position.z = (pesClip.z / pesClip.w) * gl_Position.w;`,
    );
};
function atualizarOclusao() {
  // ponto de referência: pés, puxados um pouco na direção da câmera
  const pes = new THREE.Vector3(pos.x, pos.y + 0.2, pos.z);
  // 2.4: cobre a altura do corpo vista de cima (topo de objetos logo atrás
  // fica mais perto da câmera que os pés). Menor = objetos atrás cortam a cabeça;
  // maior = o sprite começa a passar na frente de coisas que estão na frente dele.
  const praCam = camera.position
    .clone()
    .sub(pes)
    .normalize()
    .multiplyScalar(2.4);
  uniPes.uPes.value.copy(pes.add(praCam));
}

// ---- Movimento ----
const teclas = {};
let jogoPausado = true;
addEventListener("jogo:pausa", (e) => {
  jogoPausado = e.detail;
  if (jogoPausado) Object.keys(teclas).forEach((k) => (teclas[k] = false));
});
addEventListener("keydown", (e) => {
  if (["msg", "msg-nome"].includes(document.activeElement?.id)) return; // digitando: não anda
  teclas[e.key.toLowerCase()] = true;
});
addEventListener("keyup", (e) => (teclas[e.key.toLowerCase()] = false));
const pos = new THREE.Vector3(0, 0, 0);
let dir = "baixo",
  tAnim = 0;
const VEL = 9;

const relogio = new THREE.Clock();
// ---- Multiplayer ----
// Outros jogadores aparecem com o treinador original (cada um com a própria
// textura, pra animar independente). Posição chega pelo WebSocket e é suavizada.
const SALA = new URLSearchParams(location.search).get("room") || "lobby";
let NOME = "trainer";
try {
  NOME =
    localStorage.getItem("nome") ||
    `trainer${Math.floor(Math.random() * 900 + 100)}`;
} catch {}
NOME = NOME.slice(0, 16);
try {
  localStorage.setItem("nome", NOME);
} catch {}

// Trocar o nome dentro do jogo: clica no nome no topo do chat
const elNome = document.querySelector("#meu-nome");
elNome.textContent = NOME;
function trocarNome(novo) {
  novo = novo.replace(/\s+/g, " ").trim().slice(0, 16);
  if (!novo || novo === NOME) return;
  NOME = novo;
  elNome.textContent = NOME;
  try {
    localStorage.setItem("nome", NOME);
  } catch {}
  if (MULTIPLAYER && ws?.readyState === 1)
    ws.send(JSON.stringify({ t: "nome", nome: NOME }));
}
elNome.addEventListener("click", () => {
  const inp = Object.assign(document.createElement("input"), {
    value: NOME,
    maxLength: 16,
    id: "msg-nome",
  });
  elNome.replaceWith(inp);
  inp.focus();
  inp.select();
  let fechado = false;
  const fechar = (salvar) => {
    if (fechado) return; // Enter dispara blur logo depois: fecha uma vez só
    fechado = true;
    if (salvar) trocarNome(inp.value);
    if (inp.isConnected) inp.replaceWith(elNome);
  };
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation(); // não anda nem abre o chat enquanto edita
    if (e.key === "Enter") fechar(true);
    if (e.key === "Escape") fechar(false);
  });
  inp.addEventListener("blur", () => inp.isConnected && fechar(true));
});
const canvasOriginal = {}; // genero -> canvas do treinador original
const outros = new Map(); // id -> { mesh, tex, alvo, dir, passo, nome }
let meuId = null;
let ws = null;

function setQuadroTex(tex, d, passo) {
  const img = tex.image;
  if (!img || !img.width) return;
  // outros jogadores usam os treinadores originais (layout GRADE)
  const { x, y, w, h } = posQuadro(GRADE, d, passo);
  tex.repeat.set(w / img.width, h / img.height);
  tex.offset.set(x / img.width, 1 - (y + h) / img.height);
}

function criarOutro(j) {
  const g = j.genero === "feminino" ? "feminino" : "masculino";
  canvasOriginal[g] ??= gerarTreinadorOriginal(g);
  const tex = new THREE.CanvasTexture(canvasOriginal[g]);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    geoPersonagem,
    new THREE.MeshLambertMaterial({
      map: tex,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    map: tex,
    alphaTest: 0.5,
    depthPacking: THREE.RGBADepthPacking,
  });
  mesh.customDistanceMaterial = new THREE.MeshDistanceMaterial({
    map: tex,
    alphaTest: 0.5,
  });
  mesh.castShadow = true;
  mesh.scale.copy(sprite.scale);
  scene.add(mesh);
  const o = {
    mesh,
    tex,
    alvo: new THREE.Vector3(j.x, 0, j.z),
    dir: j.dir || "baixo",
    passo: j.passo || 0,
    nome: j.nome,
  };
  mesh.position.copy(o.alvo);
  outros.set(j.id, o);
  atualizarContagem();
  return o;
}
function removerOutro(id) {
  const o = outros.get(id);
  if (!o) return;
  scene.remove(o.mesh);
  o.tex.dispose();
  outros.delete(id);
  atualizarContagem();
}
function atualizarContagem() {
  const el = document.querySelector("#local small");
  if (el)
    el.textContent = `room ${SALA} · ${outros.size + 1} trainer${outros.size ? "s" : ""}`;
}

function conectar() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/${SALA}`);
  ws.onopen = () =>
    ws.send(JSON.stringify({ t: "ola", nome: NOME, genero: GENERO }));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "voce") meuId = m.id;
    else if (m.t === "estado") m.jogadores.forEach(criarOutro);
    else if (m.t === "entrou") criarOutro(m.jogador);
    else if (m.t === "saiu") removerOutro(m.id);
    else if (m.t === "chat") receberChat(m.id, m.nome, m.texto);
    else if (m.t === "radio") receberComando(m.comando);
    else if (m.t === "erro") adicionarHistorico("system", m.msg);
    else if (m.t === "nome") {
      const o = outros.get(m.id);
      if (o) o.nome = m.nome;
    } else if (m.t === "genero") {
      // recria o boneco com o visual do outro gênero, mantendo a posição
      const o = outros.get(m.id);
      if (o) {
        const j = {
          id: m.id,
          x: o.alvo.x,
          z: o.alvo.z,
          dir: o.dir,
          passo: o.passo,
          nome: o.nome,
          genero: m.genero,
        };
        removerOutro(m.id);
        criarOutro(j);
      }
    } else if (m.t === "pos") {
      const o = outros.get(m.id) || criarOutro(m);
      o.alvo.set(m.x, 0, m.z);
      o.dir = m.dir;
      o.passo = m.passo;
    }
  };
  ws.onclose = () => {
    [...outros.keys()].forEach(removerOutro);
    setTimeout(conectar, 2000); // reconecta
  };
}
const MULTIPLAYER = true;
if (MULTIPLAYER) {
  conectar();
  // comandos de admin da rádio vão pro servidor, com a senha salva
  ligarRadioAoServidor((idx) => {
    let senha = "";
    try { senha = localStorage.getItem("admin-senha") || ""; } catch {}
    if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "radio", idx, senha }));
  });
}

let ultimoEnvio = 0,
  ultimoEstado = "";
function enviarPosicao(agora, passo) {
  if (!ws || ws.readyState !== 1 || agora - ultimoEnvio < 66) return; // ~15x/s
  const estado = `${pos.x.toFixed(2)},${pos.z.toFixed(2)},${dir},${passo}`;
  if (estado === ultimoEstado) return;
  ultimoEnvio = agora;
  ultimoEstado = estado;
  ws.send(JSON.stringify({ t: "pos", x: pos.x, z: pos.z, dir, passo }));
}

function atualizarOutros(dt) {
  for (const o of outros.values()) {
    const m = o.mesh;
    m.position.x = THREE.MathUtils.lerp(
      m.position.x,
      o.alvo.x,
      Math.min(1, dt * 10),
    );
    m.position.z = THREE.MathUtils.lerp(
      m.position.z,
      o.alvo.z,
      Math.min(1, dt * 10),
    );
    m.position.y = alturaTopo(m.position.x, m.position.z);
    m.rotation.copy(sprite.rotation);
    setQuadroTex(o.tex, o.dir, o.passo);
  }
}

// ---- Chat + balão em cima da cabeça ----
const elMsgs = document.querySelector("#msgs");
const elInput = document.querySelector("#msg");
const baloes = new Map(); // dono (mesh) -> { el, ate }
const digitando = () => document.activeElement === elInput;

function adicionarHistorico(nome, texto) {
  const d = document.createElement("div");
  d.className = "m";
  const s = document.createElement("small");
  s.textContent = nome;
  const t = document.createElement("span");
  t.textContent = texto; // textContent: nada de HTML vindo do chat
  d.append(s, t);
  elMsgs.append(d);
  while (elMsgs.children.length > 60) elMsgs.firstChild.remove();
  elMsgs.scrollTop = elMsgs.scrollHeight;
}

function mostrarBalao(dono, texto) {
  let b = baloes.get(dono);
  if (!b) {
    b = {
      el: Object.assign(document.createElement("div"), { className: "balao" }),
      ate: 0,
    };
    document.body.append(b.el);
    baloes.set(dono, b);
  }
  b.el.replaceChildren(
    Object.assign(document.createElement("span"), { textContent: texto }),
  );
  b.el.style.opacity = 1;
  b.ate = performance.now() + 4000 + texto.length * 60; // fica mais tempo se for longo
}

// ---- Nome em cima de cada treinador ----
const etiquetas = new Map(); // mesh -> div
function etiqueta(mesh, nome) {
  let el = etiquetas.get(mesh);
  if (!el) {
    el = Object.assign(document.createElement("div"), { className: "tag" });
    document.body.append(el);
    etiquetas.set(mesh, el);
  }
  if (el.textContent !== nome) el.textContent = nome;
}
function atualizarEtiquetas() {
  etiqueta(sprite, NOME);
  for (const o of outros.values()) etiqueta(o.mesh, o.nome || "trainer");
  for (const [mesh, el] of etiquetas) {
    if (!mesh.parent) { el.remove(); etiquetas.delete(mesh); continue; }
    _v.set(mesh.position.x, mesh.position.y + mesh.scale.y * 0.92, mesh.position.z).project(camera);
    el.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
    el.style.display = _v.z < 1 ? "" : "none";
  }
}

const _v = new THREE.Vector3();
function atualizarBaloes() {
  const agora = performance.now();
  for (const [dono, b] of baloes) {
    if (!dono.parent || agora > b.ate) {
      b.el.style.opacity = 0;
      if (!dono.parent || agora > b.ate + 400) {
        b.el.remove();
        baloes.delete(dono);
      }
      continue;
    }
    // ponto acima da cabeça, projetado na tela
    const baseY = dono === sprite ? pos.y : dono.position.y;
    _v.set(
      dono.position.x,
      baseY + dono.scale.y * 0.95,
      dono.position.z,
    ).project(camera);
    _v.y += 20 / (innerHeight / 2); // sobe acima da etiqueta de nome
    b.el.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
    b.el.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
  }
}

function receberChat(id, nome, texto) {
  adicionarHistorico(nome, texto);
  const dono = id === meuId || id === "eu" ? sprite : outros.get(id)?.mesh;
  if (dono) mostrarBalao(dono, texto);
}

document.querySelector("#chat form").addEventListener("submit", (e) => {
  e.preventDefault();
  const texto = elInput.value.trim().slice(0, 140);
  elInput.value = "";
  elInput.blur();
  if (!texto) return;
  if (MULTIPLAYER && ws?.readyState === 1)
    ws.send(JSON.stringify({ t: "chat", texto }));
  else receberChat("eu", NOME, texto); // offline: mostra só pra mim
});
// Enter abre o chat; Esc sai
addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !digitando()) {
    e.preventDefault();
    elInput.focus();
  } else if (e.key === "Escape" && digitando()) elInput.blur();
});
elInput.addEventListener("focus", () =>
  Object.keys(teclas).forEach((k) => (teclas[k] = false)),
);

function loop() {
  const dt = Math.min(relogio.getDelta(), 0.05);
  uniAgua.uTempo.value += dt;
  let dx = 0,
    dz = 0;
  if (teclas.arrowup || teclas.w) {
    dz -= 1;
    dir = "cima";
  }
  if (teclas.arrowdown || teclas.s) {
    dz += 1;
    dir = "baixo";
  }
  if (teclas.arrowleft || teclas.a) {
    dx -= 1;
    dir = "esquerda";
  }
  if (teclas.arrowright || teclas.d) {
    dx += 1;
    dir = "direita";
  }
  if (jogoPausado) {
    dx = 0;
    dz = 0;
  }
  const andando = dx || dz;
  if (andando) {
    const n = Math.hypot(dx, dz);
    const velocidade = VEL * (teclas.shift ? 1.5 : 1);
    // move eixo por eixo pra deslizar rente às paredes
    const nx = pos.x + (dx / n) * velocidade * dt;
    if (livre(nx, pos.z, pos.y)) pos.x = nx;
    const nz = pos.z + (dz / n) * velocidade * dt;
    if (livre(pos.x, nz, pos.y)) pos.z = nz;
    tAnim += dt * 8 * (velocidade / VEL);
  } else tAnim = 0;
  const passoAtual = andando ? Math.floor(tAnim) % PERSONAGEM.passos : 0;
  const correndo = Boolean(andando && teclas.shift);
  setQuadro(dir, passoAtual, correndo);
  enviarPosicao(performance.now(), passoAtual);
  atualizarOutros(dt);

  // suaviza a altura pra não tremer em degrauzinhos do terreno
  pos.y = THREE.MathUtils.lerp(
    pos.y,
    alturaTopo(pos.x, pos.z),
    Math.min(1, dt * 12),
  );
  sprite.position.copy(pos);
  if (correndo && GENERO === "masculino") sprite.position.y -= 0.8;
  sombra.position.set(pos.x, pos.y + 0.05, pos.z);
  atualizarOclusao();
  camera.position.set(pos.x, pos.y + 38, pos.z + 42);
  camera.lookAt(pos.x, pos.y + 1, pos.z);
  // de frente pra câmera, inclinado só até a metade (a sombra fica com cara de corpo em pé)
  sprite.rotation.set(camera.rotation.x * 0.5, 0, 0);

  renderer.render(scene, camera);
  atualizarEtiquetas();
  atualizarBaloes();
  requestAnimationFrame(loop);
}
loop();
