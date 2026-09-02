import { connectHost } from '@openchamber/sdk';
import type { HostReadyContext } from '@openchamber/sdk';

const KINDS = ['cat', 'dog', 'snake', 'duck'] as const;
type Kind = (typeof KINDS)[number];

const NAMES = {
  cat: ['Mochi', 'Pixel', 'Nori', 'Bean'],
  dog: ['Toast', 'Rusty', 'Pip', 'Wally'],
  snake: ['Noodle', 'Zig', 'Coil'],
  duck: ['Quackers', 'Butter', 'Puddle'],
} as const;

type Pet = {
  id: number;
  kind: Kind;
  name: string;
  x: number;
  facing: 1 | -1;
  speed: number;
  bob: number;
  sitUntil: number;
};

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type Palette = {
  fg: string;
  muted: string;
  border: string;
  primary: string;
  bg: string;
};

const requireCanvas = (): HTMLCanvasElement => {
  const el = document.getElementById('room');
  if (!(el instanceof HTMLCanvasElement)) {
    throw new Error('Missing #room canvas');
  }
  return el;
};

const requireButton = (id: string): HTMLButtonElement => {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error(`Missing #${id}`);
  }
  return el;
};

const pick = <T>(items: readonly T[]): T => {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) {
    throw new Error('empty pick');
  }
  return item;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const readPalette = (): Palette => {
  const css = getComputedStyle(document.documentElement);
  return {
    bg: css.getPropertyValue('--oc-bg').trim() || '#111',
    fg: css.getPropertyValue('--oc-fg').trim() || '#eee',
    muted: css.getPropertyValue('--oc-muted').trim() || '#888',
    border: css.getPropertyValue('--oc-border').trim() || '#333',
    primary: css.getPropertyValue('--oc-primary').trim() || '#4af',
  };
};

const applyReady = (ctx: HostReadyContext): void => {
  document.documentElement.style.colorScheme = ctx.theme.mode;
  document.documentElement.style.setProperty('--oc-bg', ctx.theme.tokens.background);
  document.documentElement.style.setProperty('--oc-fg', ctx.theme.tokens.foreground);
  document.documentElement.style.setProperty('--oc-muted', ctx.theme.tokens.muted);
  document.documentElement.style.setProperty('--oc-border', ctx.theme.tokens.border);
  document.documentElement.style.setProperty('--oc-primary', ctx.theme.tokens.primary);
};

const host = connectHost();
host.onReady(applyReady);

const canvas = requireCanvas();
const ctx = canvas.getContext('2d');
if (!ctx) {
  throw new Error('2d canvas is unavailable');
}

const pets: Pet[] = [];
let ball: Ball | null = null;
let nextId = 1;
let last = performance.now();
let viewW = 1;
let viewH = 1;

const floorY = (): number => viewH - 18;

const spawnPet = (x?: number): Pet => {
  const kind = pick(KINDS);
  const pet: Pet = {
    id: nextId,
    kind,
    name: pick(NAMES[kind]),
    x: x ?? 24 + Math.random() * Math.max(40, viewW - 48),
    facing: Math.random() < 0.5 ? 1 : -1,
    speed: 22 + Math.random() * 28,
    bob: Math.random() * Math.PI * 2,
    sitUntil: 0,
  };
  nextId += 1;
  pets.push(pet);
  return pet;
};

const throwBall = (fromX: number, fromY: number): void => {
  const floor = floorY();
  const targetX = clamp(fromX, 12, viewW - 12);
  ball = {
    x: targetX,
    y: clamp(fromY, 20, floor - 8),
    vx: (Math.random() - 0.5) * 80,
    vy: -40,
  };
};

const stepPets = (dt: number): void => {
  const floor = floorY();
  const now = performance.now();
  const margin = 20;
  for (const pet of pets) {
    pet.bob += dt * 7;
    if (now < pet.sitUntil) {
      continue;
    }
    if (!ball && Math.random() < dt * 0.12) {
      pet.sitUntil = now + 800 + Math.random() * 1600;
      continue;
    }
    if (ball) {
      const dir = ball.x < pet.x ? -1 : 1;
      pet.facing = dir;
      pet.x += dir * pet.speed * 1.8 * dt;
      if (Math.hypot(ball.x - pet.x, ball.y - (floor - 8)) < 16) {
        const caught = pet;
        ball = null;
        void host.toast({ kind: 'success', message: `${caught.name} got the ball` });
      }
      continue;
    }
    pet.x += pet.facing * pet.speed * dt;
    if (pet.x < margin) {
      pet.x = margin;
      pet.facing = 1;
    }
    if (pet.x > viewW - margin) {
      pet.x = viewW - margin;
      pet.facing = -1;
    }
  }
};

const stepBall = (dt: number): void => {
  if (!ball) return;
  const floor = floorY();
  ball.vy += 420 * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  if (ball.x < 8 || ball.x > viewW - 8) {
    ball.vx *= -0.7;
    ball.x = clamp(ball.x, 8, viewW - 8);
  }
  if (ball.y > floor - 5) {
    ball.y = floor - 5;
    ball.vy *= -0.45;
    ball.vx *= 0.85;
    if (Math.abs(ball.vy) < 18) {
      ball.vy = 0;
    }
  }
};

const drawPet = (palette: Palette, pet: Pet, floor: number): void => {
  const hop = Math.abs(Math.sin(pet.bob)) * (performance.now() < pet.sitUntil ? 0 : 3);
  const x = pet.x;
  const y = floor - hop;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pet.facing, 1);
  ctx.fillStyle = palette.fg;
  ctx.strokeStyle = palette.fg;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (pet.kind === 'cat') {
    ctx.beginPath();
    ctx.ellipse(0, -7, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-6, -14, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-10, -16);
    ctx.lineTo(-9, -22);
    ctx.lineTo(-5, -17);
    ctx.moveTo(-2, -17);
    ctx.lineTo(1, -22);
    ctx.lineTo(2, -16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(8, -8);
    ctx.quadraticCurveTo(16, -16 - Math.sin(pet.bob) * 3, 12, -2);
    ctx.stroke();
  } else if (pet.kind === 'dog') {
    ctx.beginPath();
    ctx.ellipse(0, -7, 10, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-8, -13, 6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-13, -12, 4, 2.4, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-4, -16, 3, 5, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8, -8);
    ctx.quadraticCurveTo(14, -18, 16, -6);
    ctx.stroke();
  } else if (pet.kind === 'snake') {
    ctx.beginPath();
    for (let i = 0; i <= 8; i += 1) {
      const sx = -14 + i * 4;
      const sy = -4 + Math.sin(pet.bob + i * 0.7) * 2.4;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.lineWidth = 3.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(18, -4 + Math.sin(pet.bob + 6) * 2, 3.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = palette.primary;
    ctx.beginPath();
    ctx.ellipse(0, -8, 8, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.fg;
    ctx.beginPath();
    ctx.arc(-1, -16, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.primary;
    ctx.beginPath();
    ctx.moveTo(-6, -16);
    ctx.lineTo(-12, -14);
    ctx.lineTo(-6, -13);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
  ctx.fillStyle = palette.muted;
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(pet.name, pet.x, floor + 12);
};

const draw = (): void => {
  const palette = readPalette();
  const floor = floorY();
  ctx.clearRect(0, 0, viewW, viewH);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, viewW, viewH);

  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, floor);
  ctx.lineTo(viewW, floor);
  ctx.stroke();

  if (ball) {
    ctx.fillStyle = palette.primary;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const pet of pets) {
    drawPet(palette, pet, floor);
  }

  if (pets.length === 0) {
    ctx.fillStyle = palette.muted;
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Add a pet, or click the floor to throw a ball.', viewW / 2, viewH / 2);
  }
};

const resize = (): void => {
  const ratio = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  viewW = Math.max(1, bounds.width);
  viewH = Math.max(1, bounds.height);
  canvas.width = Math.max(1, Math.floor(viewW * ratio));
  canvas.height = Math.max(1, Math.floor(viewH * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
};

const tick = (now: number): void => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  stepBall(dt);
  stepPets(dt);
  draw();
  window.requestAnimationFrame(tick);
};

const localPoint = (event: MouseEvent) => {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
};

requireButton('add').addEventListener('click', () => {
  if (pets.length >= 8) {
    void host.toast({ kind: 'info', message: 'The room is full' });
    return;
  }
  const pet = spawnPet();
  void host.toast({ kind: 'success', message: `${pet.name} the ${pet.kind} arrived` });
});

requireButton('ball').addEventListener('click', () => {
  throwBall(viewW * 0.5, 28);
});

requireButton('clear').addEventListener('click', () => {
  pets.length = 0;
  ball = null;
});

canvas.addEventListener('click', (event) => {
  const point = localPoint(event);
  throwBall(point.x, point.y);
});

window.addEventListener('resize', resize);
resize();
spawnPet();
window.requestAnimationFrame(tick);
