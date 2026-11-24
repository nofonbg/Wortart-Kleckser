'use strict';

/* ================= Konstanten & State ================= */

const gameEl = document.getElementById('game');
const wordsEl = document.getElementById('words');
const projectilesEl = document.getElementById('projectiles');
const floatersEl = document.getElementById('floaters');
const penEl = document.getElementById('pen');
const scoreEl = document.getElementById('score');
const highEl = document.getElementById('high');
const timerArc = document.querySelector('.timer-arc');
const timerText = document.getElementById('timerText');
const startScreenEl = document.getElementById('startScreen');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const endScreenEl = document.getElementById('endScreen');
const endScoreEl = document.getElementById('endScore');
const endRestartBtn = document.getElementById('endRestart');
const typeOptions = Array.from(document.querySelectorAll('.type-option'));

const PEN_W = 76;
const PEN_H = 132;
const PEN_TIP = 34; // Federspitze über dem Körper
const PEN_SPEED = 420; // px/s (Tastatur)

const GAME_DURATION = 60; // Sekunden
const ARC_RADIUS = 42;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS; // ≈ 263.9
const POINTS = { noun: 10, article: 10, verb: 10 }; // alle Wortarten gleich
const PENALTY = 10;
const HIGH_KEY = 'stift-schuss-high';

const ALL_TYPES = ['noun', 'article', 'verb'];
const TYPE_WORDS = {
  noun: ['Sturm', 'Stern', 'Himmel', 'Meer', 'Berg', 'Weg', 'Baum', 'Donner', 'Mond', 'Sonne', 'Wolke', 'Fels', 'Raum', 'Licht'],
  article: ['DER', 'DIE', 'DAS', 'EIN', 'EINE'],
  verb: ['läuft', 'singt', 'spricht', 'macht', 'fällt', 'trägt', 'schläft', 'hofft', 'wagt', 'liest', 'lacht', 'baut', 'trinkt', 'tanzt'],
};

const state = {
  running: false,
  allowed: new Set(['noun']),
  score: 0,
  high: Number(localStorage.getItem(HIGH_KEY)) || 0,
  words: [],
  spawnTimer: null,
  spawnInterval: 1500,
  speed: 60,
  rafId: null,
  lastTime: 0,
  startTime: 0,
  pen: { x: 0, y: 0 },
  keys: new Set(),
};

/* ================= Sound ================= */

let audioCtx = null;

function beep(freq, duration = 0.08, type = 'sine', vol = 0.15) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    /* Audio nicht verfügbar – ignorieren */
  }
}

/* ================= Score ================= */

function updateScore() {
  scoreEl.textContent = state.score;
  highEl.textContent = state.high;
  if (state.score > state.high) {
    state.high = state.score;
    try {
      localStorage.setItem(HIGH_KEY, String(state.high));
    } catch (e) {
      /* ignore */
    }
  }
}

/* ================= Füller bewegen ================= */

function clampPen() {
  state.pen.x = Math.max(0, Math.min(gameEl.clientWidth - PEN_W, state.pen.x));
  state.pen.y = Math.max(40, Math.min(gameEl.clientHeight - PEN_H - 10, state.pen.y));
}

function applyPen() {
  penEl.style.left = state.pen.x + 'px';
  penEl.style.top = state.pen.y + 'px';
}

function resetPen() {
  state.pen.x = gameEl.clientWidth / 2 - PEN_W / 2;
  state.pen.y = gameEl.clientHeight - PEN_H - 40;
  clampPen();
  applyPen();
}

function movePen(dt) {
  const keys = state.keys;
  let dx = 0;
  let dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
  if (keys.has('arrowright') || keys.has('d')) dx += 1;
  if (keys.has('arrowup') || keys.has('w')) dy -= 1;
  if (keys.has('arrowdown') || keys.has('s')) dy += 1;
  if (dx === 0 && dy === 0) return;
  const len = Math.hypot(dx, dy);
  state.pen.x += (dx / len) * PEN_SPEED * dt;
  state.pen.y += (dy / len) * PEN_SPEED * dt;
  clampPen();
  applyPen();
}

/* ================= Fallende Wörter ================= */

function spawnWord() {
  if (!state.running) return;

  const type = ALL_TYPES[Math.floor(Math.random() * ALL_TYPES.length)];
  const text = TYPE_WORDS[type][Math.floor(Math.random() * TYPE_WORDS[type].length)];

  const el = document.createElement('div');
  el.className = 'word type-' + type;
  el.textContent = text;
  wordsEl.appendChild(el);

  const w = {
    id: Date.now() + Math.random(),
    type,
    text,
    el,
    x: 30 + Math.random() * Math.max(60, gameEl.clientWidth - 60),
    y: -60,
    speed: state.speed,
    width: el.offsetWidth,
  };
  w.width = el.offsetWidth;
  el.style.left = w.x - w.width / 2 + 'px';
  el.style.top = w.y + 'px';
  state.words.push(w);

  state.spawnTimer = setTimeout(spawnWord, state.spawnInterval);
  state.spawnInterval = Math.max(450, state.spawnInterval - 35);
  state.speed = Math.min(170, 60 + (1500 - state.spawnInterval) * 0.24);
}

/* ================= Zeitscheibe ================= */

function updateTimer(remaining) {
  const frac = Math.max(0, remaining / GAME_DURATION);
  timerArc.style.strokeDashoffset = String(ARC_CIRCUMFERENCE * (1 - frac));
  timerText.textContent = Math.ceil(remaining);
  timerArc.style.stroke = remaining <= 10 ? '#ff6b81' : remaining <= 25 ? '#ffd166' : '#7cffb2';
}

/* ================= Loop ================= */

function loop(now) {
  const dt = Math.min(0.05, (now - state.lastTime) / 1000);
  state.lastTime = now;

  if (state.running) {
    const remaining = GAME_DURATION - (now - state.startTime) / 1000;
    updateTimer(remaining);

    if (remaining <= 0) {
      endGame();
    } else {
      movePen(dt);
      for (let i = state.words.length - 1; i >= 0; i--) {
        const w = state.words[i];
        w.y += w.speed * dt;
        w.el.style.top = w.y + 'px';
        if (w.y + w.el.offsetHeight >= gameEl.clientHeight) {
          state.words.splice(i, 1);
          w.el.remove();
          if (state.allowed.has(w.type)) {
            endGame();
            break;
          }
        }
      }
    }
  }

  state.rafId = requestAnimationFrame(loop);
}

/* ================= Tintenklecks ================= */

function splat(x, y, size) {
  const big = document.createElement('div');
  big.className = 'splat';
  const s = Math.max(120, size || 180);
  big.style.width = s + 'px';
  big.style.height = s * 0.95 + 'px';
  big.style.margin = '-' + (s * 0.95 / 2) + 'px 0 0 -' + (s / 2) + 'px';
  big.style.left = x + 'px';
  big.style.top = y + 'px';
  projectilesEl.appendChild(big);
  big.animate(
    [
      { transform: 'scale(0.02)', opacity: 1, offset: 0 },
      { transform: 'scale(1)', opacity: 1, offset: 0.35 },
      { transform: 'scale(1.12)', opacity: 0, offset: 1 },
    ],
    { duration: 1000, easing: 'ease-out' }
  ).onfinish = () => big.remove();

  for (let i = 0; i < 6; i++) {
    const drop = document.createElement('div');
    drop.className = 'splat-drop';
    drop.style.left = x + 'px';
    drop.style.top = y + 'px';
    projectilesEl.appendChild(drop);
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 100;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    drop.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(0.3)', opacity: 0 },
      ],
      { duration: 500 + Math.random() * 300, easing: 'ease-out' }
    ).onfinish = () => drop.remove();
  }
}

function floatText(text, x, y, color) {
  const el = document.createElement('div');
  el.className = 'floater';
  el.textContent = text;
  el.style.color = color;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  floatersEl.appendChild(el);
  el.animate(
    [
      { transform: 'translateY(0)', opacity: 1 },
      { transform: 'translateY(-80px)', opacity: 0, offset: 1 },
    ],
    { duration: 850 }
  ).onfinish = () => el.remove();
}

/* ================= Treffer / Penalty ================= */

function hit(word) {
  const i = state.words.indexOf(word);
  if (i === -1) return;
  state.words.splice(i, 1);

  const cx = word.x;
  const cy = word.y + word.el.offsetHeight / 2;
  word.el.remove();
  const size = Math.max(word.el.offsetWidth, word.el.offsetHeight) * 2.1;
  splat(cx, cy, size);

  if (state.allowed.has(word.type)) {
    state.score += POINTS[word.type];
    floatText('+' + POINTS[word.type], cx, word.y - 8, '#7CFFB2');
    beep(520, 0.09, 'sine', 0.2);
  } else {
    state.score = Math.max(0, state.score - PENALTY);
    floatText('-' + PENALTY, cx, word.y - 8, '#FF6B81');
    beep(160, 0.18, 'sawtooth', 0.12);
  }

  updateScore();
}

/* ================= Schuss ================= */

function fire() {
  if (!state.running) return;

  const nibX = state.pen.x + PEN_W / 2;
  const nibY = state.pen.y - PEN_TIP;

  let target = null;
  let bestBottom = -Infinity;
  for (const w of state.words) {
    const bottom = w.y + w.el.offsetHeight;
    const withinX = nibX >= w.x - w.width / 2 && nibX <= w.x + w.width / 2;
    if (withinX && bottom <= nibY + 8 && bottom > bestBottom) {
      target = w;
      bestBottom = bottom;
    }
  }

  if (!target) return; // Fehlschuss ohne Treffer

  const start = { x: nibX, y: nibY };
  const end = { x: target.x, y: target.y + target.el.offsetHeight / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  const duration = Math.max(120, (dist / 1100) * 1000);

  const el = document.createElement('div');
  el.className = 'projectile';
  el.style.left = start.x + 'px';
  el.style.top = start.y + 'px';
  projectilesEl.appendChild(el);
  el.animate(
    [
      { transform: 'translate(0px, 0px)' },
      { transform: 'translate(' + dx + 'px, ' + dy + 'px)', offset: 1 },
    ],
    { duration: duration, easing: 'linear' }
  ).onfinish = () => {
    el.remove();
    hit(target);
  };
}

/* ================= Game Flow ================= */

function clearField() {
  state.words.forEach((w) => w.el.remove());
  state.words = [];
  wordsEl.innerHTML = '';
  projectilesEl.innerHTML = '';
  floatersEl.innerHTML = '';
}

function backToSelection() {
  state.running = false;
  state.keys.clear();
  clearTimeout(state.spawnTimer);
  clearField();
  endScreenEl.classList.add('hidden');
  updateScore();
  startScreenEl.classList.remove('hidden');
}

function endGame() {
  if (!state.running) return;
  state.running = false;
  state.keys.clear();
  clearTimeout(state.spawnTimer);
  clearField();
  updateScore(); // speichert Rekord

  endScoreEl.textContent = state.score;
  endScreenEl.classList.remove('hidden');
  beep(220, 0.45, 'sawtooth', 0.15);
}

function startGame() {
  state.running = true;
  state.score = 0;
  state.words = [];
  state.keys.clear();
  wordsEl.innerHTML = '';
  projectilesEl.innerHTML = '';
  floatersEl.innerHTML = '';
  state.spawnInterval = 1500;
  state.speed = 60;
  state.startTime = performance.now();
  updateTimer(GAME_DURATION);

  scoreEl.textContent = '0';
  endScreenEl.classList.add('hidden');
  startScreenEl.classList.add('hidden');
  updateScore();
  resetPen();

  cancelAnimationFrame(state.rafId);
  state.lastTime = performance.now();
  state.rafId = requestAnimationFrame(loop);
  spawnWord();
}

/* ================= Startbildschirm ================= */

function selectedTypes() {
  const set = new Set();
  for (const btn of typeOptions) {
    if (btn.classList.contains('selected')) set.add(btn.dataset.type);
  }
  return set;
}

startBtn.addEventListener('click', () => {
  const sel = selectedTypes();
  if (sel.size !== 1) return; // genau eine Wortart
  state.allowed = sel;
  startGame();
});

restartBtn.addEventListener('click', () => backToSelection());
endRestartBtn.addEventListener('click', () => backToSelection());

for (const btn of typeOptions) {
  btn.addEventListener('click', () => {
    // nur eine Wortart darf ausgewählt sein
    for (const other of typeOptions) {
      other.classList.toggle('selected', other === btn);
    }
  });
}

/* ================= Eingabe ================= */

gameEl.addEventListener('pointermove', (e) => {
  if (!state.running) return;
  const r = gameEl.getBoundingClientRect();
  state.pen.x = e.clientX - r.left - PEN_W / 2;
  state.pen.y = e.clientY - r.top - PEN_H / 2;
  clampPen();
  applyPen();
});

gameEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return; // nur linke Maustaste
  if (e.target.closest('button')) return;
  fire();
});

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === ' ') {
    if (e.target.closest('button')) return; // Button-Tastaturnavigation zulassen
    e.preventDefault();
    fire();
    return;
  }
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) {
    e.preventDefault();
    state.keys.add(key);
  }
});

window.addEventListener('keyup', (e) => {
  state.keys.delete(e.key.toLowerCase());
});

window.addEventListener('blur', () => state.keys.clear());

/* ================= Init ================= */

resetPen();
updateScore();
