// Dev-only cat & performance debug module, mounted inside the unified Debug Hub (src/debug.js).
export function createCatDebugModule({
  THREE,
  renderer,
  scene,
  cats,
  baseCatCount,
  createCat,
  useFeetDepth,
  clearBubble,
  getCatNav,
  getNavBuildMs,
  getPlayerCount,
  toggleDebugRide,
  getRideLabel,
}) {
  let rows = null;
  let countButtons = [];
  let gridBtn = null;
  let headBtn = null;
  let showGrid = false;
  let gridGroup = null;
  let pointsObj = null;
  let pathLine = null;
  let lastLeg = null;

  const frameWindow = [];
  let avgFrameMs = 16.7;
  let smoothCatMs = 0;
  let lastDomUpdate = 0;

  function setDebugCatCount(targetCount) {
    const wanted = Math.max(baseCatCount, Math.min(10, targetCount | 0));
    while (cats.length > wanted && cats[cats.length - 1].debug) {
      const removed = cats.pop();
      clearBubble(removed.mesh);
      scene.remove(removed.mesh);
      removed.sprite.dispose();
    }
    const debugCoats = ["black", "orange", "calico", "tuxedo", "siamese"];
    for (let i = cats.length; i < wanted; i++) {
      const palette = debugCoats[i % debugCoats.length];
      const sprite = createCat(palette);
      sprite.mesh.position.set(0, 0, 5);
      scene.add(sprite.mesh);
      cats.push({
        id: `debug-${i}`,
        palette,
        seed: 101 + i * 37,
        speed: 2.3 + (i % 4) * 0.2,
        debug: true,
        sprite,
        mesh: sprite.mesh,
        feet: useFeetDepth(sprite.mesh),
        fed: { at: 0, until: 0, lost: 0 },
        leg: null,
        pose: "sit",
        dir: "down",
        ride: null,
        rideAnim: null,
        hopOff: null,
        afterRide: null,
        lastRideAt: null,
        ridingMesh: null,
        ridingFeet: null,
      });
    }
  }

  function syncCountButtons() {
    for (const { n, btn } of countButtons) btn.classList.toggle("on", n === cats.length);
  }

  function clearGroup(group) {
    if (!group) return;
    for (const child of [...group.children]) {
      child.geometry?.dispose();
      child.material?.dispose();
      group.remove(child);
    }
  }

  function rebuildGridPoints() {
    if (!gridGroup) return;
    if (pointsObj) {
      pointsObj.geometry.dispose();
      pointsObj.material.dispose();
      gridGroup.remove(pointsObj);
      pointsObj = null;
    }
    const nodes = getCatNav().nodes;
    if (!nodes.length) return;
    const pos = new Float32Array(nodes.length * 3);
    for (let i = 0; i < nodes.length; i++) {
      pos[i * 3] = nodes[i].x;
      pos[i * 3 + 1] = nodes[i].y + 0.18;
      pos[i * 3 + 2] = nodes[i].z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x58e07a, size: 0.45, sizeAttenuation: true });
    pointsObj = new THREE.Points(geo, mat);
    gridGroup.add(pointsObj);
  }

  function syncPathLine() {
    if (!gridGroup) return;
    const leg = cats[0]?.leg || null;
    if (leg === lastLeg) return;
    lastLeg = leg;
    if (pathLine) {
      pathLine.geometry.dispose();
      pathLine.material.dispose();
      gridGroup.remove(pathLine);
      pathLine = null;
    }
    if (!leg || leg.path.length < 2) return;
    const pts = leg.path.map((n) => new THREE.Vector3(n.x, n.y + 0.25, n.z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xffc95a });
    pathLine = new THREE.Line(geo, mat);
    gridGroup.add(pathLine);
  }

  function renderMetrics(now, force = false) {
    if (!rows || (!force && now - lastDomUpdate < 250)) return;
    lastDomUpdate = now;

    let maxMs = avgFrameMs;
    for (let i = 0; i < frameWindow.length; i++) {
      if (frameWindow[i] > maxMs) maxMs = frameWindow[i];
    }
    const fps = avgFrameMs > 0 ? Math.round(1000 / avgFrameMs) : 0;
    const minFps = maxMs > 0 ? Math.round(1000 / maxMs) : 0;
    rows.fps.textContent = `${fps} (min ${minFps})`;
    rows.fps.className = fps < 30 ? "bad" : fps < 50 ? "warn" : "";

    rows.frame.textContent = `${avgFrameMs.toFixed(1)} ms`;
    rows.frame.className = avgFrameMs > 33 ? "bad" : avgFrameMs > 20 ? "warn" : "";

    const info = renderer.info;
    rows.calls.textContent = String(info.render.calls);
    rows.tris.textContent = info.render.triangles.toLocaleString("en-US");
    rows.gpu.textContent = `${info.memory.textures} tex · ${info.memory.geometries} geo`;
    const heapBytes = performance.memory?.usedJSHeapSize;
    rows.heap.textContent = Number.isFinite(heapBytes) ? `${(heapBytes / 1048576).toFixed(1)} MB` : "n/a";
    rows.players.textContent = `${getPlayerCount()} online`;

    let walk = 0,
      sit = 0,
      eat = 0;
    for (const c of cats) {
      if (c.pose === "walk") walk++;
      else if (c.pose === "eat") eat++;
      else sit++;
    }
    rows.cats.textContent = `${cats.length} (${walk}/${sit}/${eat})`;
    rows.catCpu.textContent = `${smoothCatMs.toFixed(2)} ms`;
    rows.nav.textContent = `${getCatNav().nodes.length} (${getNavBuildMs().toFixed(0)} ms)`;

    const c0 = cats[0];
    if (c0) {
      const p = c0.mesh.position;
      const rideLabel = getRideLabel?.(c0);
      rows.cat0.textContent = rideLabel || `${p.x.toFixed(1)}, ${p.z.toFixed(1)} · ${c0.dir || "down"} · ${c0.pose || "sit"}`;
    } else {
      rows.cat0.textContent = "none";
    }
    headBtn?.classList.toggle("on", !!c0?.ride);
  }

  return {
    id: "cats",
    title: "cat debug",
    desc: "fps, draw calls & navgrid",
    mount(container) {
      const dl = document.createElement("dl");
      rows = {};
      for (const [key, label] of [
        ["fps", "fps"],
        ["frame", "frame"],
        ["calls", "draw calls"],
        ["tris", "triangles"],
        ["gpu", "gpu mem"],
        ["heap", "js heap"],
        ["players", "players"],
        ["cats", "cats"],
        ["catCpu", "cat cpu"],
        ["nav", "navgrid"],
        ["cat0", "cat #1"],
      ]) {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = "—";
        dl.append(dt, dd);
        rows[key] = dd;
      }

      const controls = document.createElement("div");
      controls.className = "dbg-controls";
      controls.append(Object.assign(document.createElement("span"), { textContent: "cats:" }));
      const counts = [baseCatCount, ...[2, 5, 8, 10].filter((n) => n > baseCatCount)];
      countButtons = counts.map((n) => {
        const btn = Object.assign(document.createElement("button"), {
          type: "button",
          textContent: String(n),
        });
        btn.addEventListener("click", () => {
          setDebugCatCount(n);
          syncCountButtons();
          renderMetrics(performance.now(), true);
          btn.blur();
        });
        controls.append(btn);
        return { n, btn };
      });

      gridBtn = Object.assign(document.createElement("button"), {
        type: "button",
        textContent: "grid",
      });
      gridBtn.style.marginLeft = "auto";
      gridBtn.addEventListener("click", () => {
        showGrid = !showGrid;
        gridBtn.classList.toggle("on", showGrid);
        if (showGrid) {
          gridGroup = new THREE.Group();
          scene.add(gridGroup);
          lastLeg = null;
          rebuildGridPoints();
          syncPathLine();
        } else if (gridGroup) {
          clearGroup(gridGroup);
          scene.remove(gridGroup);
          gridGroup = pointsObj = pathLine = lastLeg = null;
        }
        gridBtn.blur();
      });
      controls.append(gridBtn);
      if (toggleDebugRide) {
        headBtn = Object.assign(document.createElement("button"), {
          type: "button",
          textContent: "head",
          title: "toggle cat on your head",
        });
        headBtn.addEventListener("click", () => {
          toggleDebugRide();
          renderMetrics(performance.now(), true);
          headBtn.blur();
        });
        controls.append(headBtn);
      }
      container.append(dl, controls);
      syncCountButtons();
    },
    onOpen() {
      syncCountButtons();
      renderMetrics(performance.now(), true);
    },
    needsTiming: (visible) => visible || showGrid,
    onNavRebuilt() {
      if (showGrid) {
        lastLeg = null;
        rebuildGridPoints();
        syncPathLine();
      }
      renderMetrics(performance.now(), true);
    },
    update({ frameMs, catMs, visible }) {
      if (showGrid) syncPathLine();
      if (!visible) return;
      const clamped = Math.min(250, Math.max(0.1, frameMs));
      frameWindow.push(clamped);
      if (frameWindow.length > 60) frameWindow.shift();
      let sum = 0;
      for (let i = 0; i < frameWindow.length; i++) sum += frameWindow[i];
      avgFrameMs = sum / frameWindow.length;
      smoothCatMs = smoothCatMs ? smoothCatMs * 0.85 + catMs * 0.15 : catMs;
      renderMetrics(performance.now(), false);
    },
  };
}
