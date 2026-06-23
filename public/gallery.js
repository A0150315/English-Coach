// public/gallery.js — 3D Word Galaxy. Each word is a glowing point + text label.
// Size = occurrence count, color = status. Orbit to look around, hover to highlight,
// click to expand meanings (reuses /api/word). Shares the localStorage key with the table view.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Text } from "troika-three-text";

const KEY = "english_coach_key";
let apiKey = localStorage.getItem(KEY) || "";

const STATUS_COLOR = {
  new: 0x58a6ff, // blue
  known: 0x3fb950, // green
  conflict: 0xf0883e, // orange (legacy, shouldn't appear)
};

// --- DOM ---
const $status = document.getElementById("status");
const $detail = document.getElementById("detail");
const $detailContent = document.getElementById("detail-content");
document.getElementById("detail-close").addEventListener("click", () => {
  $detail.hidden = true;
});
document.getElementById("key").value = apiKey;
document.getElementById("save-key").addEventListener("click", () => {
  apiKey = document.getElementById("key").value.trim();
  localStorage.setItem(KEY, apiKey);
  loadWords();
});

// --- scene ---
const canvas = document.getElementById("galaxy");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.Fog(0x0d1117, 30, 90);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(0, 0, 45);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.4;

// subtle ambient + point light so materials read
scene.add(new THREE.AmbientLight(0x404060, 1.2));
const point = new THREE.PointLight(0xffffff, 0.6);
point.position.set(0, 0, 30);
scene.add(point);

const wordGroup = new THREE.Group();
scene.add(wordGroup);

const stars = []; // { mesh, label, word }
let hovered = null;

function sizeFor(count) {
  // 0.6 .. 2.4 based on count
  return 0.6 + Math.min(count, 10) * 0.18;
}

function buildGalaxy(words) {
  // clear
  for (const s of stars) {
    wordGroup.remove(s.mesh);
    wordGroup.remove(s.label);
    s.label.dispose();
  }
  stars.length = 0;

  const n = words.length;
  words.forEach((w, i) => {
    // distribute on a sphere shell with golden-angle spiral
    const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = 18 + Math.sin(i * 1.7) * 2; // slight shell jitter
    const pos = new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
    );

    const color = STATUS_COLOR[w.status] || STATUS_COLOR.new;
    const size = sizeFor(w.count || 1);

    // glowing point
    const geo = new THREE.SphereGeometry(size * 0.5, 12, 12);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      roughness: 0.4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    wordGroup.add(mesh);

    // text label
    const label = new Text();
    label.text = w.word;
    label.fontSize = 1.1;
    label.color = "#c9d1d9";
    label.anchorX = "center";
    label.anchorY = "middle";
    label.position.copy(pos).add(new THREE.Vector3(0, size + 0.8, 0));
    wordGroup.add(label);

    stars.push({ mesh, label, word: w, baseColor: color, baseSize: size });
  });
}

// --- interaction: hover + click via raycaster ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerActive = false;

canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  pointerActive = true;
});
canvas.addEventListener("pointerleave", () => {
  pointerActive = false;
  setHovered(null);
});
canvas.addEventListener("click", () => {
  if (hovered) openDetail(hovered.word);
});

function setHovered(s) {
  if (hovered === s) return;
  if (hovered) {
    hovered.label.color = "#c9d1d9";
    hovered.label.fontSize = 1.1;
    hovered.mesh.scale.setScalar(1);
  }
  hovered = s;
  if (s) {
    s.label.color = "#ffffff";
    s.label.fontSize = 1.6;
    s.mesh.scale.setScalar(1.6);
    canvas.style.cursor = "pointer";
    controls.autoRotate = false;
  } else {
    canvas.style.cursor = "grab";
    controls.autoRotate = true;
  }
}

function checkHover() {
  if (!pointerActive) return;
  raycaster.setFromCamera(pointer, camera);
  const meshes = stars.map((s) => s.mesh);
  const hits = raycaster.intersectObjects(meshes);
  setHovered(hits.length ? stars[hitIndex(hits[0].object)] : null);
}
function hitIndex(mesh) {
  return stars.findIndex((s) => s.mesh === mesh);
}

async function openDetail(w) {
  $detail.hidden = false;
  $detailContent.innerHTML = `<h3>${esc(w.word)}</h3><div class="g">${esc(
    w.meaning_zh,
  )} · ×${w.count || 1} · ${w.status}</div><div class="detail-loading">loading…</div>`;
  try {
    const r = await fetch(`/api/word?id=${w.id}`, {
      headers: { "X-Coach-Key": apiKey },
    });
    if (!r.ok) throw 0;
    const { meanings } = await r.json();
    const list = meanings.length
      ? meanings
          .map(
            (m) =>
              `<div class="meaning"><span class="mg">${esc(
                m.meaning,
              )}</span>${m.example ? `<span class="ex">— ${esc(m.example)}</span>` : ""}</div>`,
          )
          .join("")
      : "<em>(no usages)</em>";
    $detailContent.innerHTML = `<h3>${esc(w.word)}</h3><div class="g">${esc(
      w.meaning_zh,
    )} · ×${w.count || 1} · ${w.status}</div>${list}`;
  } catch {
    $detailContent.innerHTML = "<em>(failed to load)</em>";
  }
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- data ---
async function loadWords() {
  if (!apiKey) {
    $status.textContent = "enter key";
    return;
  }
  $status.textContent = "loading…";
  try {
    const r = await fetch("/api/words", { headers: { "X-Coach-Key": apiKey } });
    if (!r.ok) {
      $status.textContent = "auth failed";
      return;
    }
    const { words } = await r.json();
    if (!words.length) {
      $status.textContent = "no words yet";
      return;
    }
    buildGalaxy(words);
    $status.textContent = `${words.length} words`;
  } catch {
    $status.textContent = "offline";
  }
}

// --- render loop + resize ---
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight - 56; // minus header
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

function animate() {
  requestAnimationFrame(animate);
  checkHover();
  controls.update();
  // labels always face the camera
  for (const s of stars) s.label.lookAt(camera.position);
  renderer.render(scene, camera);
}

loadWords();
animate();
