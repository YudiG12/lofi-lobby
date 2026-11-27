import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createGame, isTttSeat, TTT_SEAT_X, TTT_SEAT_O } from "../worker/tictactoe.js";
import "./tictactoe.css";

const MARK_COLORS = { X: "#ff8a7a", O: "#5fd8e8" };
const GOLD = "#ffc95a";
const TOP = 2.0;
const CHAIR_OFFSET = 1.9;
export const TABLE_STAND_DISTANCE = 2.5;
const BOARD_SIZE = 96;
const CELL_SIZE = 28;
const cellCenter = (cell) => [20 + (cell % 3) * CELL_SIZE, 20 + Math.floor(cell / 3) * CELL_SIZE];

function paintBoard(canvas, game) {
  const c = canvas.getContext("2d");
  c.fillStyle = "#ae8055";
  c.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);
  c.fillStyle = "#35251f";
  c.fillRect(2, 2, 92, 92);
  for (let cell = 0; cell < 9; cell++) {
    const [x, y] = cellCenter(cell);
    c.fillStyle = game.winLine?.includes(cell) ? "#685031" : "#463129";
    c.fillRect(x - 13, y - 13, 26, 26);
  }
  if (game.winLine) {
    c.strokeStyle = GOLD;
    c.lineWidth = 3;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(...cellCenter(game.winLine[0]));
    c.lineTo(...cellCenter(game.winLine[2]));
    c.stroke();
  }
  game.board.forEach((mark, cell) => {
    if (!mark) return;
    const [x, y] = cellCenter(cell);
    c.strokeStyle = MARK_COLORS[mark];
    c.lineWidth = 4;
    c.lineCap = "square";
    c.beginPath();
    if (mark === "X") {
      c.moveTo(x - 6, y - 6);
      c.lineTo(x + 6, y + 6);
      c.moveTo(x + 6, y - 6);
      c.lineTo(x - 6, y + 6);
    } else c.arc(x, y, 7, 0, Math.PI * 2);
    c.stroke();
  });
}

function addBoxes(group, boxes) {
  const byMaterial = new Map();
  for (const [material, w, h, d, x, y, z] of boxes) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(x, y, z);
    let list = byMaterial.get(material);
    if (!list) byMaterial.set(material, (list = []));
    list.push(geo);
  }
  for (const [material, list] of byMaterial) {
    const merged = mergeGeometries(list, false);
    for (const geo of list) geo.dispose();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function makeTable(woodLight, woodDark, ironMaterial, texture) {
  const table = new THREE.Group();
  const boxes = [[woodDark, 2.1, 0.16, 2.1, 0, TOP - 0.16, 0]];
  for (const x of [-0.7, 0, 0.7]) {
    boxes.push([woodLight, 0.69, 0.08, 2.1, x, TOP - 0.04, 0]);
  }
  for (const side of [-1, 1]) {
    boxes.push([woodDark, 1.78, 0.22, 0.14, 0, 1.65, side * 0.82]);
    boxes.push([woodDark, 0.14, 0.22, 1.78, side * 0.82, 1.65, 0]);
    for (const z of [-0.82, 0.82]) {
      boxes.push([ironMaterial, 0.18, 1.66, 0.18, side * 0.82, 0.83, z]);
    }
  }
  addBoxes(table, boxes);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.56, 1.56),
    new THREE.MeshLambertMaterial({ map: texture, emissiveMap: texture, emissive: "#fff", emissiveIntensity: 0.22 }),
  );
  board.rotation.x = -Math.PI / 2;
  board.position.y = TOP + 0.01;
  board.receiveShadow = true;
  table.add(board);

  const wax = new THREE.MeshLambertMaterial({ color: "#efe3c4", emissive: "#423721", flatShading: true });
  const stub = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.18), wax);
  stub.position.set(-0.88, TOP + 0.11, 0.88);
  const fire = new THREE.MeshBasicMaterial({ color: "#ffd27a" });
  const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.095), fire);
  flame.position.set(-0.88, TOP + 0.32, 0.88);
  const light = new THREE.PointLight("#ffb14a", 0, 10, 1.6);
  light.position.set(-0.88, TOP + 0.48, 0.88);
  light.castShadow = false;
  table.add(stub, flame, light);
  return { table, flame, light };
}

function makeChair(woodLight, woodDark, ironMaterial, sitLift, side) {
  const chair = new THREE.Group();
  const boxes = [];
  // Local +z points toward the table. The rear legs support the backrest.
  for (const x of [-0.56, 0.56]) {
    boxes.push([ironMaterial, 0.15, 1.48, 0.15, x, 0.74, 0.46]);
    boxes.push([ironMaterial, 0.15, 2.58, 0.15, x, 1.29, -0.54]);
    boxes.push([ironMaterial, 0.15, 0.14, 1.08, x, 1.38, -0.04]);
  }
  // Like a bench, the hips sit a little above the sprite's feet origin.
  [0.39, 0, -0.39].forEach((z, i) => {
    boxes.push([i === 1 ? woodDark : woodLight, 1.38, 0.16, 0.35, 0, sitLift + 0.57, z]);
  });
  boxes.push([woodDark, 1.38, 0.27, 0.16, 0, 2.0, -0.58]);
  boxes.push([woodLight, 1.38, 0.29, 0.16, 0, 2.43, -0.58]);
  addBoxes(chair, boxes);
  chair.rotation.y = -side * Math.PI / 2;
  chair.position.x = side * CHAIR_OFFSET;
  return chair;
}

function tableLocation({ isOpen, isFree, groundHeight, inPond, benches, lampPosts, board }, seatOffset) {
  // Search from the front-yard grass centered in front of the lower-right house window,
  // tucked cleanly into the yard and well back from the yellow sand path (z ~ 19.4).
  const clear = (x, z, maxZ = Infinity) =>
    z <= maxZ &&
    benches.every((b) => Math.hypot(b.x - x, b.z - z) > 5.5) &&
    lampPosts.every(({ position: p }) => Math.hypot(p.x - x, p.z - z) > 4) &&
    Math.hypot(board.position.x - x, board.position.z - z) > 7 &&
    [-3, 0, 3].every((dx) => [-2.5, 0, 2.5].every((dz) => !inPond(x + dx, z + dz))) &&
    // Tight ground-footprint checks let the set sit neatly in the house's front yard without clipping walls.
    isOpen(x, z, 0.7) &&
    isOpen(x - CHAIR_OFFSET, z, 0.55) && isOpen(x + CHAIR_OFFSET, z, 0.55) &&
    [-seatOffset, seatOffset].every((dx) => isFree(x + dx, z + TABLE_STAND_DISTANCE, groundHeight(x, z)));
  for (const maxZ of [14.5, 15.3, 16.5, Infinity]) {
    for (let r = 0; r <= 12; r += 0.5) {
      const steps = r === 0 ? 1 : 16;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = 17.2 + Math.cos(a) * r;
        const z = 14.3 + Math.sin(a) * r;
        if (clear(x, z, maxZ)) return { x, z };
      }
    }
  }
  return null;
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  if (tag === "button") el.type = "button";
  return el;
}

function createHud({ playCell, voteRematch, standUp }) {
  const root = element("section", "glass");
  root.id = "ttt";
  root.hidden = true;
  root.setAttribute("aria-labelledby", "ttt-title");
  // Let Space activate focused HUD buttons instead of bubbling to the global pause shortcut.
  root.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.closest("button")) e.stopPropagation();
  });
  const header = element("header");
  const title = element("h2", "", "tic-tac-toe");
  title.id = "ttt-title";
  const up = element("button", "stand", "stand up");
  const key = element("kbd", "", "E");
  key.setAttribute("aria-hidden", "true");
  up.append(key);
  up.setAttribute("aria-keyshortcuts", "E");
  up.onclick = () => { up.blur(); standUp(); };
  header.append(title, up);

  const players = element("div", "players");
  const names = {};
  const points = {};
  for (const mark of ["X", "O"]) {
    const player = element("div", "player");
    const symbol = element("span", "mark", mark);
    symbol.dataset.mark = mark;
    names[mark] = element("span", "name");
    points[mark] = element("span", "pts", "0");
    player.append(symbol, names[mark], points[mark]);
    players.append(player);
  }
  const draws = element("p", "draws");
  draws.hidden = true;
  const status = element("p", "status");
  status.setAttribute("role", "status");

  const grid = element("div", "cells");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "tic-tac-toe board");
  const cells = Array.from({ length: 9 }, (_, cell) => {
    const button = element("button", "cell");
    button.onclick = () => {
      button.blur();
      playCell(cell);
    };
    grid.append(button);
    return button;
  });
  const footer = element("footer");
  const rematch = element("button", "rematch");
  rematch.onclick = () => {
    rematch.blur();
    voteRematch();
  };
  footer.append(rematch);
  root.append(header, players, draws, status, grid, footer);
  document.body.append(root);
  return { root, names, points, draws, status, cells, footer, rematch };
}

function statusText(game, online, myMark, names) {
  if (!online) return "offline · reconnecting…";
  if (game.status === "waiting") return game.notice === "opponent left" ? "opponent left · waiting…" : "waiting for opponent…";
  if (game.status === "playing") return game.turn === myMark ? "your turn" : `${names[game.turn]}'s turn`;
  if (game.status === "won") return game.winner === myMark ? "you win!" : myMark ? "you lose!" : `${names[game.winner]} wins!`;
  return "draw!";
}

export function createTicTacToe(scene, options) {
  const { woodLight, woodDark, ironMaterial, sitLift, sideSeatForward, getPlayerInfo, getMyId, getMySeat, isOverlayBlocked } = options;
  const seatOffset = CHAIR_OFFSET - sideSeatForward;
  let game = createGame();
  let online = false;
  const seats = new Map();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = BOARD_SIZE;
  paintBoard(canvas, game);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  const group = new THREE.Group();
  group.name = "TicTacToe";
  const { table, flame, light } = makeTable(woodLight, woodDark, ironMaterial, texture);
  const xChair = makeChair(woodLight, woodDark, ironMaterial, sitLift, -1);
  const oChair = makeChair(woodLight, woodDark, ironMaterial, sitLift, 1);
  group.add(xChair, table, oChair);

  function getTurn() {
    const seat = getMySeat();
    const mark = seat === TTT_SEAT_X ? "X" : seat === TTT_SEAT_O ? "O" : null;
    const myMark = mark && game.players[mark] === getMyId() ? mark : null;
    const available = online && myMark && !isOverlayBlocked();
    const finished = game.status === "won" || game.status === "draw";
    return {
      myMark,
      finished,
      canMove: available && game.status === "playing" && game.turn === myMark,
      canRematch: available && finished && !game.rematch[myMark],
    };
  }

  const hud = createHud({
    playCell(cell) {
      if (getTurn().canMove && game.board[cell] === null) options.sendMove(cell, game.rev);
    },
    voteRematch() {
      if (getTurn().canRematch) options.sendRematch(game.rev);
    },
    standUp: options.standUp,
  });
  let previous = {};
  function updateHud() {
    hud.root.hidden = !isTttSeat(getMySeat()) || isOverlayBlocked();
    if (hud.root.hidden) return;
    const { myMark, finished, canMove, canRematch } = getTurn();
    const x = game.players.X && getPlayerInfo(game.players.X);
    const o = game.players.O && getPlayerInfo(game.players.O);
    if (previous.game === game && previous.online === online && previous.myMark === myMark &&
        previous.x?.name === x?.name && previous.x?.color === x?.color &&
        previous.o?.name === o?.name && previous.o?.color === o?.color) return;
    previous = { game, online, myMark, x, o };

    const names = { X: x?.name || "waiting…", O: o?.name || "waiting…" };
    for (const [mark, player] of [["X", x], ["O", o]]) {
      const name = hud.names[mark];
      name.textContent = names[mark];
      name.style.color = player?.color || "";
      hud.points[mark].textContent = String(game.score[mark] ?? 0);
      name.parentElement.classList.toggle("active", online && game.status === "playing" && game.turn === mark);
    }
    const { draws } = game.score;
    hud.draws.hidden = !draws;
    hud.draws.textContent = draws ? `${draws} ${draws === 1 ? "draw" : "draws"}` : "";
    const status = statusText(game, online, myMark, names);
    if (hud.status.textContent !== status) hud.status.textContent = status;
    hud.cells.forEach((button, cell) => {
      const mark = game.board[cell];
      button.textContent = mark || "";
      button.dataset.mark = mark || "";
      button.disabled = !canMove || !!mark;
      button.classList.toggle("win", !!game.winLine?.includes(cell));
      button.setAttribute("aria-label", `row ${Math.floor(cell / 3) + 1}, column ${cell % 3 + 1}, ${mark || "empty"}`);
    });
    const voted = myMark && game.rematch[myMark];
    const accept = myMark && game.rematch[myMark === "X" ? "O" : "X"] && !voted;
    hud.footer.hidden = !finished;
    hud.rematch.disabled = !canRematch;
    hud.rematch.textContent = voted ? "waiting for rematch…" : accept ? "accept rematch" : "rematch";
    hud.rematch.classList.toggle("accept", !!accept);
  }

  return {
    place(town) {
      if (seats.size) return;
      const spot = tableLocation(town, seatOffset);
      if (!spot) return;
      const { x, z } = spot;
      const y = town.groundHeight(x, z);
      group.position.set(x, y, z);
      scene.add(group);
      group.updateMatrixWorld(true);
      for (const piece of group.children) {
        // Separate bounds let setFeet skip a sitter's own chair.
        const bounds = new THREE.Box3().setFromObject(piece);
        town.solidBoxes.push(bounds);
        town.benchBoxes.push(bounds);
      }
      seats.set(TTT_SEAT_X, { x: x - seatOffset, y: y + sitLift, z, dir: "right", table: true });
      seats.set(TTT_SEAT_O, { x: x + seatOffset, y: y + sitLift, z, dir: "left", table: true });
    },
    seatSpot: (id) => seats.get(id) ?? null,
    setGame(next) {
      if (!next || !Array.isArray(next.board)) return;
      const boardChanged = game.board.some((mark, cell) => mark !== next.board[cell]);
      const winChanged = (game.winLine?.join(",") || "") !== (next.winLine?.join(",") || "");
      if (boardChanged || winChanged) {
        paintBoard(canvas, next);
        texture.needsUpdate = true;
      }
      game = next;
    },
    setOnline(value) { online = value; },
    update(_dt, dayAmount, time) {
      const night = 1 - dayAmount;
      const flicker = 0.9 + 0.1 * Math.sin(time * 9) * Math.sin(time * 5.3);
      light.intensity = night * flicker * 3.6;
      flame.scale.y = (0.88 + 0.12 * Math.sin(time * 11)) * night;
      flame.visible = night > 0.01;
      updateHud();
    },
  };
}
