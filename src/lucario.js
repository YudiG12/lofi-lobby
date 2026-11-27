// Lucario #448 sprites from PMDCollab/SpriteCollab.
// Every animation has eight directional rows: down, down-right, right, up-right,
// up, up-left, left, down-left. Frame sizes and timing follow AnimData.xml.
import * as THREE from "three";

export const LUCARIO_NEAR = 5.5;
export const LUCARIO_RADIUS = 1.45;

const TICK_MS = 1000 / 60;
const SHEETS = {
  walk: {
    file: "Walk-Anim.png", columns: 4, rows: 8, frameWidth: 32, frameHeight: 48,
    durations: [6, 6, 6, 6],
  },
  idle: {
    file: "Idle-Anim.png", columns: 6, rows: 8, frameWidth: 32, frameHeight: 56,
    durations: [40, 2, 2, 4, 2, 2],
  },
  pet: {
    file: "Nod-Anim.png", columns: 3, rows: 8, frameWidth: 32, frameHeight: 48,
    durations: [6, 8, 6],
  },
  aura: {
    file: "Charge-Anim.png", columns: 10, rows: 8, frameWidth: 32, frameHeight: 40,
    durations: Array(10).fill(2),
  },
};

// atan2 sectors are ordered right, down-right, down, down-left, left,
// up-left, up, up-right; SpriteCollab rows start at down.
const DIRECTION_ROWS = [2, 1, 0, 7, 6, 5, 4, 3];

function createAura() {
  const canvas = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const ctx = canvas.getContext("2d");
  const glow = ctx.createRadialGradient(32, 32, 5, 32, 32, 31);
  glow.addColorStop(0, "rgba(66,174,255,.04)");
  glow.addColorStop(.55, "rgba(66,174,255,.22)");
  glow.addColorStop(.78, "rgba(123,211,255,.62)");
  glow.addColorStop(1, "rgba(66,174,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const aura = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = .08;
  aura.visible = false;
  aura.renderOrder = 9;
  return aura;
}

// One pixel of any sheet is always the same size in the world, so Lucario never
// grows or shrinks when the pose or the frame changes. Lucario is ~25 px tall in
// the sheets and mesh.scale turns that into the same number of world units.
// Reference heights: trainer ~3.75, cats ~3.05, so Lucario sits just above the cats.
const LUCARIO_HEIGHT = 3.3;
const MESH_SCALE = LUCARIO_HEIGHT;
const UNITS_PER_PIXEL = 1 / 25;
// Fallback ground rows (px from the top of a cell) used until the sheet pixels can be read.
const DEFAULT_FOOT_ROW = { walk: 30, idle: 33, pet: 30, aura: 26 };
const ALPHA_MIN = 32;

export function createLucario() {
  const loader = new THREE.TextureLoader();
  const sheets = Object.fromEntries(Object.entries(SHEETS).map(([pose, config]) => {
    const texture = loader.load(`/assets/lucario/${config.file}`);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    // Always sample the WHOLE cell: never crop frames, so nothing can be cut off.
    texture.repeat.set(config.frameWidth / (config.columns * config.frameWidth), 1 / config.rows);
    return [pose, { ...config, texture, footRows: null, geometries: new Map() }];
  }));

  // Ground row of each direction: the lowest paw pixel of the whole animation row.
  // It is a constant per (sheet, direction), so bobbing frames lift off the ground
  // naturally instead of jittering, and every pose lands on the same ground point.
  const footRowOf = (pose, sheet, row) => {
    if (!sheet.footRows) {
      const image = sheet.texture.image;
      if (!image?.width || !image?.height) return DEFAULT_FOOT_ROW[pose];
      try {
        const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
        const { frameWidth: fw, frameHeight: fh, columns, rows } = sheet;
        // Only the central columns: a tail, an aura or a raised arm may reach below the paws.
        const x0 = Math.floor(fw * .2), x1 = Math.ceil(fw * .8);
        sheet.footRows = Array.from({ length: rows }, (_, r) => {
          let lowest = -1;
          for (let f = 0; f < columns; f++) {
            for (let y = fh - 1; y > lowest; y--) {
              const py = (r * fh + y) * image.width + f * fw;
              let hit = false;
              for (let x = x0; x < x1; x++) if (pixels[(py + x) * 4 + 3] >= ALPHA_MIN) { hit = true; break; }
              if (hit) { lowest = y; break; }
            }
          }
          return lowest >= 0 ? lowest : DEFAULT_FOOT_ROW[pose];
        });
      } catch {
        return DEFAULT_FOOT_ROW[pose];
      }
    }
    return sheet.footRows[row];
  };

  // The plane covers the full cell; only its vertical offset depends on the ground row,
  // so that the paws' lower edge sits at local y = 0 (the mesh's sampled ground position,
  // where the cast shadow, the contact shadow and the feet-depth trick all expect it).
  const geometryFor = (pose, sheet, row) => {
    const foot = footRowOf(pose, sheet, row);
    const key = `${row}:${foot}`;
    let geometry = sheet.geometries.get(key);
    if (!geometry) {
      geometry = new THREE.PlaneGeometry(
        sheet.frameWidth * UNITS_PER_PIXEL,
        sheet.frameHeight * UNITS_PER_PIXEL,
      );
      geometry.translate(0, -(sheet.frameHeight / 2 - (foot + 1)) * UNITS_PER_PIXEL, 0);
      sheet.geometries.set(key, geometry);
    }
    return geometry;
  };

  const initial = sheets.idle;
  const material = new THREE.MeshLambertMaterial({
    map: initial.texture,
    alphaTest: .5,
    transparent: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometryFor("idle", initial, 0), material);
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    map: initial.texture,
    alphaTest: .5,
    depthPacking: THREE.RGBADepthPacking,
  });
  mesh.customDistanceMaterial = new THREE.MeshDistanceMaterial({
    map: initial.texture,
    alphaTest: .5,
  });
  mesh.castShadow = true;
  // Same readable size as before, kept on the mesh because the speech bubble and the
  // prompt are positioned from mesh.scale.y in main.js.
  mesh.scale.set(MESH_SCALE, MESH_SCALE, 1);

  const aura = createAura();
  let pose = "idle";
  let directionRow = 0;
  let lastFrame = -1;
  let poseStartedAt = performance.now();

  let lastSheet = null;
  let lastRow = -1;
  const setFrame = (frame, sheet) => {
    if (frame === lastFrame && sheet === lastSheet && directionRow === lastRow) return;
    const image = sheet.texture.image;
    if (!image?.width || !image?.height) return; // Keep the previous valid frame until the texture is ready.
    lastFrame = frame;
    lastSheet = sheet;
    lastRow = directionRow;
    sheet.texture.repeat.set(sheet.frameWidth / image.width, sheet.frameHeight / image.height);
    sheet.texture.offset.set(
      (frame * sheet.frameWidth) / image.width,
      1 - ((directionRow + 1) * sheet.frameHeight) / image.height,
    );
    // Geometries are cached per (sheet, direction): nothing is created or disposed per frame.
    mesh.geometry = geometryFor(pose, sheet, directionRow);
  };

  const setPose = (next) => {
    const safe = sheets[next] ? next : "idle";
    if (safe === pose) return;
    pose = safe;
    poseStartedAt = performance.now();
    lastFrame = -1;
    lastSheet = null;
    lastRow = -1;

    const sheet = sheets[pose];
    material.map = sheet.texture;
    material.needsUpdate = true;
    mesh.customDepthMaterial.map = sheet.texture;
    mesh.customDepthMaterial.needsUpdate = true;
    mesh.customDistanceMaterial.map = sheet.texture;
    mesh.customDistanceMaterial.needsUpdate = true;
  };

  return {
    mesh,
    aura,
    setPose,
    setFacing(direction) {
      this.setDirection(direction, 0);
    },
    setDirection(dx, dz) {
      if (Math.abs(dx) < .001 && Math.abs(dz) < .001) return;
      const sector = (Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) + 8) % 8;
      const next = DIRECTION_ROWS[sector];
      if (next !== directionRow) {
        directionRow = next;
        lastFrame = -1;
      }
    },
    update(t) {
      const sheet = sheets[pose];
      const total = sheet.durations.reduce((sum, ticks) => sum + ticks * TICK_MS, 0);
      let elapsed = Math.max(0, t - poseStartedAt) % total;
      let frame = 0;
      while (frame < sheet.durations.length - 1) {
        const duration = sheet.durations[frame] * TICK_MS;
        if (elapsed < duration) break;
        elapsed -= duration;
        frame++;
      }
      setFrame(frame, sheet);

      const active = pose === "aura";
      aura.visible = active;
      if (active) {
        const pulse = 1 + .045 * Math.sin(t / 420);
        aura.scale.set(pulse, pulse, 1);
        aura.material.opacity = .68 + .12 * Math.sin(t / 620);
      }
    },
  };
}
