// public/gallery.js — 3D Word Galaxy. Each word is a glowing point + an HTML label
// positioned by projecting its 3D coords to screen space (no troika/text-in-WebGL).
// Size = occurrence count, color = status. Orbit to look around, hover to highlight,
// click to expand meanings (reuses /api/word). Shares the localStorage key with the table view.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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
const $labels = document.createElement("div");
$labels.id = "labels";
document.body.appendChild($labels);
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

const stars = []; // { mesh, el, pos, word }
let hovered = null;

function sizeFor(count) {
  // 0.6 .. 2.4 based on count
  return 0.6 + Math.min(count, 10) * 0.18;
}

function buildGalaxy(words) {
  // clear old
  for (const s of stars) {
    wordGroup.remove(s.mesh);
    s.el.remove();
  }
  stars.length = 0;
  $labels.innerHTML = "";

  const n = words.length;
  const projected = new THREE.Vector3();
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

    // HTML label, positioned each frame by projecting pos to screen
    const el = document.createElement("div");
    el.className = `label ${w.status}`;
    el.textContent = w.word;
    el.addEventListener("pointerenter", () => setHovered(star));
    el.addEventListener("pointerleave", () => setHovered(null));
    el.addEventListener("click", () => openDetail(w));
    $labels.appendChild(el);

    const star = { mesh, el, pos: pos.clone(), word: w, baseSize: size };
    stars.push(star);
    void projected;
  });
}

// --- interaction: hover + click ---
function setHovered(s) {
  if (hovered === s) return;
  if (hovered) {
    hovered.el.classList.remove("hover");
    hovered.mesh.scale.setScalar(1);
  }
  hovered = s;
  if (s) {
    s.el.classList.add("hover");
    s.mesh.scale.setScalar(1.6);
    controls.autoRotate = false;
  } else {
    controls.autoRotate = true;
  }
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
  // measure the actual header height (it wraps on mobile) instead of hardcoding 56
  const headerH = document.querySelector("header")?.offsetHeight ?? 56;
  document.documentElement.style.setProperty("--header-h", headerH + "px");
  const h = window.innerHeight - headerH;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

const _v = new THREE.Vector3();
function positionLabels() {
  const rect = canvas.getBoundingClientRect();
  for (const s of stars) {
    _v.copy(s.pos);
    _v.project(camera); // to NDC (-1..1)
    // behind camera?
    if (_v.z > 1) {
      s.el.style.display = "none";
      continue;
    }
    const x = (_v.x * 0.5 + 0.5) * rect.width;
    const y = (-_v.y * 0.5 + 0.5) * rect.height;
    s.el.style.display = "";
    s.el.style.transform = `translate(${x}px, ${y}px)`;
  }
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  positionLabels();
  renderer.render(scene, camera);
}

loadWords();
animate();
