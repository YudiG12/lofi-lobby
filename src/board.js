// Message wall: a cork board in the town (3D) and the wall screen it opens (DOM).
// Notes come from /api/notes (worker/index.js keeps them forever); new and deleted
// notes arrive live on the room's WebSocket (onNote / onNoteDeleted).
import * as THREE from "three";
import "./board.css";

const COLORS = { cream: "#f4ead2", yellow: "#ffe08a", pink: "#ffc2cf", blue: "#bfe0ff", green: "#c9ecb4", lilac: "#dccbff" };
const NEAR = 5.5; // how close you need to be for the "read the wall" prompt
const MAX = 2000;
const PINS = ["#e0473e", "#3e7be0", "#e0b23e", "#3ea86a"];

// ---- 3D board ----
// same family as the houses around it: olive-brown planks, darker beams, the green of their roofs
const wood = new THREE.MeshLambertMaterial({ color: "#9a8a5a", flatShading: true });
const darkWood = new THREE.MeshLambertMaterial({ color: "#6f6342", flatShading: true });
const roofing = new THREE.MeshLambertMaterial({ color: "#1f7a5c", flatShading: true });
const cork = document.createElement("canvas");
cork.width = 96;
cork.height = 64;
const corkTex = new THREE.CanvasTexture(cork);
corkTex.magFilter = THREE.NearestFilter;
corkTex.minFilter = THREE.NearestFilter;
corkTex.colorSpace = THREE.SRGBColorSpace;

// deterministic "random" from a string, so a note always sits the same way
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function paintCork(notes) {
  const c = cork.getContext("2d");
  c.fillStyle = "#b8a274";
  c.fillRect(0, 0, 96, 64);
  // cork grain: specks from a small seeded generator (always the same board, evenly spread)
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 260; i++) {
    c.fillStyle = rand() < 0.66 ? "#a58f62" : "#c8b384";
    c.fillRect(Math.floor(rand() * 96), Math.floor(rand() * 64), 1, 1);
  }
  // the latest notes, as little papers with a pin
  const spots = [[6, 6], [30, 4], [55, 7], [76, 5], [10, 34], [36, 33], [60, 35], [80, 36]];
  notes.slice(0, spots.length).forEach((n, i) => {
    const [x, y] = spots[i];
    const h = hash(n.id);
    const w = 14 + (h % 4), ht = 18 + ((h >> 3) % 5);
    c.fillStyle = "rgba(0,0,0,.25)";
    c.fillRect(x + 1, y + 1, w, ht);
    c.fillStyle = COLORS[n.color] || COLORS.cream;
    c.fillRect(x, y, w, ht);
    c.fillStyle = "rgba(125,112,72,.1)"; // paper that has been outside for a while
    c.fillRect(x, y, w, ht);
    c.fillStyle = "rgba(60,40,30,.45)";
    for (let l = 0; l < 4; l++) c.fillRect(x + 2, y + 5 + l * 3, w - 4 - ((h >> l) % 5), 1);
    c.fillStyle = PINS[h % 4];
    c.fillRect(x + (w >> 1) - 1, y - 1, 3, 3);
  });
  corkTex.needsUpdate = true;
}
paintCork([]);

export function createBoard(scene) {
  const g = new THREE.Group();
  const box = (w, h, d, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  // posts stop under the roof
  box(0.5, 5.6, 0.5, darkWood, -3.4, 2.8, 0);
  box(0.5, 5.6, 0.5, darkWood, 3.4, 2.8, 0);
  box(7.2, 4.4, 0.35, wood, 0, 3.6, 0); // frame
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 3.7),
    new THREE.MeshLambertMaterial({ map: corkTex }),
  );
  panel.position.set(0, 3.6, 0.19);
  g.add(panel);
  // a little roof keeps the rain off
  const roofL = box(4.2, 0.25, 1.6, roofing, -1.9, 6.35, 0);
  roofL.rotation.z = 0.22;
  const roofR = box(4.2, 0.25, 1.6, roofing, 1.9, 6.35, 0);
  roofR.rotation.z = -0.22;
  // no light of its own: it stands by the lamp posts
  scene.add(g);
  return g;
}

// ---- wall screen ----
const $ = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const ago = (at) => {
  const s = (Date.now() - at) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
  return new Date(at).toLocaleDateString();
};
const newestFirst = (a, b) => (a.id < b.id ? 1 : -1);

// The "wall key": a random secret kept in this browser. The server stores its hash with each note you
// write, and showing it again is what lets you edit or delete that note (there are no accounts).
function wallKey(create) {
  try {
    let k = localStorage.getItem("wall-key");
    if (!k && create) {
      k = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("wall-key", k);
    }
    return k || "";
  } catch {
    return "";
  }
}

export function setupWall({ getName, getGender, isAdmin }) {
  const notes = new Map(); // id -> note
  const cards = new Map(); // id -> its paper on the cork
  let more = true, loading = false, open = false, color = "cream", total = 0, columns = [];
  // the order of the wall: "top" (most liked first) or "new". The server pages it; `cursor` is where the next page starts
  let sort = "top", cursor = null, round = 0;
  try { if (localStorage.getItem("wall-sort") === "new") sort = "new"; } catch {}
  const inOrder = (a, b) => (sort === "top" && (b.likes | 0) - (a.likes | 0)) || newestFirst(a, b);
  let editing = null; // id of the note being edited (the composer is reused), or null for a new one
  let draft = { text: "", color }; // a new note half written, kept while you edit another

  const root = $("div");
  root.id = "wall";
  root.hidden = true;
  root.innerHTML = `
    <div class="board" role="dialog" aria-label="message wall">
      <header>
        <b>message wall</b><small class="count"></small>
        <div class="sort" role="group" aria-label="order"><button type="button" data-sort="top">♥ top</button><button type="button" data-sort="new">new</button></div>
        <button class="write" type="button">+ pin<span> a note</span></button>
        <button class="close" type="button" aria-label="close">✕</button>
      </header>
      <div class="cork">
        <div class="notes"></div>
        <p class="empty" hidden>the wall is empty. be the first.</p>
        <div class="more"></div>
      </div>
    </div>
    <div class="over" data-over="compose" hidden>
      <form class="compose paper">
        <i class="pin"></i>
        <textarea maxlength="${MAX}" placeholder="leave something for whoever passes by…"></textarea>
        <div class="row"><div class="colors"></div><small class="left"></small></div>
        <div class="row">
          <small class="err"></small>
          <button type="button" class="cancel">cancel</button>
          <button type="submit" class="pin-it">pin it</button>
        </div>
      </form>
    </div>
    <div class="over" data-over="zoom" hidden></div>
    <div class="over" data-over="confirm" hidden>
      <div class="ask paper">
        <i class="pin"></i>
        <p class="text">delete this note?</p>
        <blockquote></blockquote>
        <small>it comes off the wall for everyone and can't be brought back.</small>
        <div class="row">
          <small class="err"></small>
          <button type="button" class="cancel">keep it</button>
          <button type="button" class="danger">delete</button>
        </div>
      </div>
    </div>`;
  document.body.append(root);

  const elCork = root.querySelector(".cork");
  const elNotes = root.querySelector(".notes");
  const elCount = root.querySelector(".count");
  const elEmpty = root.querySelector(".empty");
  const compose = root.querySelector("[data-over=compose]");
  const zoom = root.querySelector("[data-over=zoom]");
  const confirm = root.querySelector("[data-over=confirm]");
  const form = compose.querySelector("form");
  const area = form.querySelector("textarea");
  const left = form.querySelector(".left");
  const err = form.querySelector(".err");
  const colors = form.querySelector(".colors");
  for (const [name, hex] of Object.entries(COLORS)) {
    const b = $("button", name === color ? "on" : "");
    b.type = "button";
    b.style.background = hex;
    b.setAttribute("aria-label", name + " paper");
    b.dataset.color = name;
    b.addEventListener("click", () => {
      setColor(name);
      area.focus({ preventScroll: true });
    });
    colors.append(b);
  }
  function setColor(name) {
    color = COLORS[name] ? name : "cream";
    colors.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.color === color));
    form.dataset.color = color;
  }
  setColor(color);

  const updateLeft = () => {
    const n = MAX - area.value.length;
    left.textContent = n < 300 ? `${n} left` : "";
  };
  area.addEventListener("input", updateLeft);

  // while the wall is open every key belongs to it: no walking, no chat, no game shortcuts.
  // Esc closes one layer at a time; Cmd/Ctrl+Enter pins the note being written; E or B closes the wall
  addEventListener("keydown", (e) => {
    if (!open) return;
    e.stopPropagation();
    if (e.key === "Escape") {
      if (!confirm.hidden) confirm.hidden = true;
      else if (!zoom.hidden) zoom.hidden = true;
      else if (!compose.hidden) closeCompose();
      else close();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !compose.hidden) form.requestSubmit();
    // the keys that open the wall also close it (not while writing: there they are letters)
    else if (/^[eb]$/i.test(e.key) && compose.hidden && confirm.hidden && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) close();
  }, true);

  function card(n) {
    const el = $("article", "paper");
    el.dataset.color = n.color;
    const h = hash(n.id);
    el.style.setProperty("--tilt", ((h % 7) - 3) * 0.45 + "deg");
    el.style.setProperty("--pin", PINS[h % 4]);
    const text = $("p", "text", n.text); // textContent: never HTML from a note
    const foot = $("footer");
    const time = $("time", "", ago(n.at) + (n.edited ? " · edited" : ""));
    time.dataset.at = n.at;
    if (n.edited) time.title = "edited " + ago(n.edited);
    foot.append($("span", "who " + n.gender, n.name), time, likeButton(n.id));
    el.append($("i", "pin"), text, foot);
    // your own note: edit and delete. The admin can delete any note. Deleting always asks first
    if (n.mine || isAdmin()) {
      const acts = $("div", "acts");
      const act = (label, fn) => {
        const b = $("button", "", label);
        b.type = "button";
        b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
        acts.append(b);
      };
      if (n.mine) act("edit", () => openCompose(n));
      // a note from before notes had owners: the admin can take it, and then edit it
      else if (n.open) act("claim", () => claim(n));
      act("delete", () => askDelete(n));
      el.classList.toggle("mine", !!n.mine);
      el.append(acts);
    }
    // a long note is cut on the cork and opens whole on click
    el.addEventListener("click", () => {
      if (!el.classList.contains("long")) return;
      const big = el.cloneNode(true);
      big.classList.remove("long", "new");
      big.querySelector(".acts")?.remove();
      big.querySelector(".like").replaceWith(likeButton(n.id)); // a clone doesn't keep the click
      zoom.replaceChildren(big);
      zoom.hidden = false;
    });
    return el;
  }

  // ---- likes ----
  // every heart of a note on screen (its paper on the cork, and the same note opened big)
  function paintLike(id, el) {
    const n = notes.get(id);
    for (const b of el ? [el] : root.querySelectorAll(".like")) {
      if (b.dataset.id !== id || !n) continue;
      b.textContent = "♥" + (n.likes > 0 ? " " + n.likes : "");
      b.classList.toggle("on", !!n.liked);
      b.setAttribute("aria-pressed", !!n.liked);
      b.title = n.liked ? "unlike" : "like";
    }
  }
  function likeButton(id) {
    const b = $("button", "like");
    b.type = "button";
    b.dataset.id = id;
    b.addEventListener("click", (e) => { e.stopPropagation(); like(id); });
    paintLike(id, b);
    return b;
  }
  const liking = new Set(); // notes with a like on its way
  async function like(id) {
    const n = notes.get(id);
    if (!n || liking.has(id)) return;
    liking.add(id);
    const on = !n.liked;
    // show it at once; the answer (or the room's broadcast) brings the real count
    const set = (likes, liked) => { const x = notes.get(id); if (x) { x.likes = likes; x.liked = liked; paintLike(id); } };
    set(Math.max(0, (n.likes | 0) + (on ? 1 : -1)), on);
    try {
      const r = await fetch(`/api/notes/${id}/like`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: wallKey(true), on }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "could not like it");
      set(body.likes, body.liked);
    } catch (x) {
      set(Math.max(0, (notes.get(id)?.likes | 0) + (on ? -1 : 1)), !on);
      for (const b of root.querySelectorAll(".like")) if (b.dataset.id === id) b.title = x.message;
    }
    liking.delete(id);
  }
  function onNoteLiked(id, likes) {
    const n = notes.get(id);
    if (!n || liking.has(id)) return; // our own like: its answer has the count
    n.likes = likes;
    paintLike(id);
  }

  // switching the order starts the wall over from the server
  const sortButtons = [...root.querySelectorAll("[data-sort]")];
  const markSort = () => sortButtons.forEach((b) => b.classList.toggle("on", b.dataset.sort === sort));
  markSort();
  sortButtons.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.sort === sort) return;
    sort = b.dataset.sort;
    try { localStorage.setItem("wall-sort", sort); } catch {}
    markSort();
    round++; // a page still on its way belongs to the other order: drop it
    notes.clear();
    cursor = null;
    more = true;
    loading = false;
    layout();
    elCork.scrollTop = 0;
    load();
  }));

  // Masonry by hand: each note goes to the shortest column, so older notes loading in (or a new
  // one arriving) never reshuffle what you are reading, and the newest read left to right.
  const columnCount = () => Math.max(1, Math.min(4, Math.floor((elCork.clientWidth - 20) / (innerWidth < 640 ? 160 : 220))));
  const shortest = () => columns.reduce((a, b) => (b.offsetHeight < a.offsetHeight ? b : a));
  function place(n, where) {
    const el = card(n);
    const old = cards.get(n.id);
    cards.set(n.id, el);
    if (old?.isConnected) old.replaceWith(el); // an edited note stays where it was
    else shortest()[where](el);
    el.classList.toggle("long", el.querySelector(".text").scrollHeight > el.querySelector(".text").clientHeight + 2);
    return el;
  }
  function layout() {
    columns = Array.from({ length: columnCount() }, () => $("div", "col"));
    elNotes.replaceChildren(...columns);
    cards.clear();
    [...notes.values()].sort(inOrder).forEach((n) => place(n, "append"));
    status();
  }
  function status() {
    elEmpty.hidden = notes.size > 0 || loading;
    const n = Math.max(total, notes.size);
    elCount.textContent = n ? `${n.toLocaleString()} ${n === 1 ? "note" : "notes"}` : "";
    paintCork([...notes.values()].sort(newestFirst));
  }
  new ResizeObserver(() => open && columns.length !== columnCount() && layout()).observe(elCork);

  async function load() {
    if (loading || !more) return;
    loading = true;
    const mine = round;
    try {
      const key = wallKey(); // tells the server which notes are yours, and which you liked
      const r = await fetch(`/api/notes?sort=${sort}` + (cursor ? "&after=" + encodeURIComponent(cursor) : ""), key ? { headers: { "X-Wall-Key": key } } : {});
      const body = await r.json();
      if (mine !== round) return;
      cursor = body.next;
      more = !!body.next;
      total = body.total;
      loading = false;
      for (const n of body.notes) {
        if (notes.has(n.id)) continue;
        notes.set(n.id, n);
        if (open) place(n, "append");
      }
    } catch {
      if (mine !== round) return;
      loading = false;
      more = false;
    }
    status();
    // a tall screen can show the whole first page: keep going until the cork is full
    if (open && more && elCork.scrollHeight <= elCork.clientHeight + 200) load();
  }
  // older notes as you scroll down
  new IntersectionObserver((e) => e[0].isIntersecting && open && load(), { root: elCork, rootMargin: "300px" })
    .observe(root.querySelector(".more"));

  // deleting asks first, on a note of its own
  let deleting = null;
  function askDelete(n) {
    deleting = n;
    confirm.querySelector("blockquote").textContent = n.text.length > 140 ? n.text.slice(0, 140) + "…" : n.text;
    confirm.querySelector(".ask").dataset.color = n.color;
    confirm.querySelector(".err").textContent = "";
    confirm.hidden = false;
  }
  confirm.querySelector(".cancel").addEventListener("click", () => (confirm.hidden = true));
  confirm.addEventListener("click", (e) => e.target === confirm && (confirm.hidden = true));
  confirm.querySelector(".danger").addEventListener("click", async () => {
    const n = deleting;
    if (!n) return;
    const headers = {};
    if (n.mine) headers["X-Wall-Key"] = wallKey();
    else try { headers.Authorization = "Bearer " + (localStorage.getItem("admin-password") || ""); } catch {}
    const box = confirm.querySelector(".ask");
    box.classList.add("busy");
    try {
      const r = await fetch("/api/notes/" + n.id, { method: "DELETE", headers });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "could not delete it, try again");
      confirm.hidden = true;
      onNoteDeleted(n.id);
    } catch (x) {
      confirm.querySelector(".err").textContent = x.message;
    }
    box.classList.remove("busy");
  });

  async function claim(n) {
    let password = "";
    try { password = localStorage.getItem("admin-password") || ""; } catch {}
    const r = await fetch(`/api/notes/${n.id}/claim`, { method: "POST", headers: { Authorization: "Bearer " + password, "X-Wall-Key": wallKey(true) } });
    const body = await r.json().catch(() => ({}));
    if (r.ok) return onNoteEdited(body.note);
    const el = cards.get(n.id)?.querySelector(".acts button");
    if (el) el.textContent = body.error || "could not claim";
  }

  // the composer writes a new note, or edits one of yours
  function openCompose(n) {
    editing = n ? n.id : null;
    // a fresh note starts on a random paper (never the one you used last), so the wall gets its colours by itself
    if (!n && !draft.text) {
      const others = Object.keys(COLORS).filter((c) => c !== draft.color);
      draft.color = others[Math.floor(Math.random() * others.length)];
    }
    area.value = n ? n.text : draft.text;
    setColor(n ? n.color : draft.color);
    form.querySelector(".pin-it").textContent = n ? "save" : "pin it";
    err.textContent = "";
    updateLeft();
    compose.hidden = false;
    area.focus({ preventScroll: true });
  }
  function closeCompose() {
    if (!editing) draft = { text: area.value, color };
    compose.hidden = true;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = area.value.trim();
    if (!text) return area.focus({ preventScroll: true });
    err.textContent = "";
    form.classList.add("busy");
    try {
      const r = await fetch("/api/notes" + (editing ? "/" + editing : ""), {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, color, name: getName(), gender: getGender(), key: wallKey(true) }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "could not pin it, try again");
      compose.hidden = true;
      if (editing) onNoteEdited(body.note);
      else {
        draft = { text: "", color };
        onNote(body.note, body.total);
        elCork.scrollTop = 0;
      }
    } catch (x) {
      err.textContent = x.message;
    }
    form.classList.remove("busy");
  });
  root.querySelector(".write").addEventListener("click", () => openCompose(null));
  form.querySelector(".cancel").addEventListener("click", closeCompose);
  root.querySelector(".close").addEventListener("click", () => close());
  // a click outside closes that layer (a note being written is kept for next time)
  root.addEventListener("click", (e) => e.target === root && close());
  compose.addEventListener("click", (e) => e.target === compose && closeCompose());
  zoom.addEventListener("click", () => (zoom.hidden = true));

  function show() {
    if (open) return;
    open = true;
    root.hidden = false;
    document.activeElement?.blur?.();
    layout(); // also refreshes every "x min ago"
    if (!notes.size || (more && elCork.scrollHeight <= elCork.clientHeight + 200)) load();
  }
  function close() {
    open = false;
    root.hidden = true;
    zoom.hidden = true;
    confirm.hidden = true;
    if (!compose.hidden) closeCompose();
  }

  // live, from the room's WebSocket (and our own note, from the POST: whichever comes first)
  function onNote(n, count) {
    if (count) total = count;
    if (!notes.has(n.id)) {
      notes.set(n.id, n);
      if (open) place(n, "prepend").classList.add("new");
    } else if (n.mine && !notes.get(n.id).mine) onNoteEdited(n); // the broadcast got here before our own answer
    status();
  }
  function onNoteEdited(n) {
    const old = notes.get(n.id);
    if (!old) return; // not loaded here yet: it will come edited when it loads
    notes.set(n.id, { ...n, mine: n.mine || (old.mine && !n.open), liked: old.liked }); // what the room sends doesn't say what is yours
    if (open) place(notes.get(n.id));
    status();
  }
  function onNoteDeleted(id, count) {
    if (count != null) total = count;
    else if (notes.has(id)) total = Math.max(0, total - 1);
    notes.delete(id);
    if (deleting?.id === id) confirm.hidden = true;
    if (editing === id && !compose.hidden) compose.hidden = true;
    cards.get(id)?.remove();
    cards.delete(id);
    status();
  }

  load(); // the board in town shows the latest notes
  // our name changed: the notes we wrote are signed again with it (only if this browser ever wrote one)
  function rename() {
    const key = wallKey();
    if (!key) return;
    fetch("/api/notes/name", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: getName(), gender: getGender(), key }),
    }).catch(() => {});
  }
  return { show, close, isOpen: () => open, rename, onNote, onNoteEdited, onNoteDeleted, onNoteLiked, NEAR };
}
