import { Fluid } from './fluid.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const $ = (s) => document.querySelector(s);

// Pigments are in linear "dye" units; they accumulate, so keep them small.
const PALETTES = {
  Sumi:     [[.02, .10, .55], [.85, .16, .04], [.55, .50, .42]],
  Kiln:     [[.90, .32, .04], [.70, .06, .10], [.95, .62, .20]],
  Tidepool: [[.00, .42, .45], [.05, .14, .60], [.55, .78, .62]],
  Bone:     [[.62, .58, .50], [.30, .28, .25], [.85, .80, .70]],
};
let palette = PALETTES.Sumi;
let hue = 0;
const pigment = (k = 1) => {
  const n = palette.length, t = (hue + performance.now() / 1000 * .16) % n, i = Math.floor(t), f = t - i;
  const a = palette[i], b = palette[(i + 1) % n], s = f * f * (3 - 2 * f);
  return a.map((v, j) => (v + (b[j] - v) * s) * k);
};

/* ---------------- fluid ---------------- */
let fluid = null;
try {
  fluid = new Fluid($('#fluid'), { dyeRes: coarse ? 512 : 1024, simRes: coarse ? 96 : 128 });
} catch (e) {
  console.warn(e);
  document.documentElement.classList.add('no-gl');
}

const W = () => innerWidth, H = () => innerHeight;
const pointer = { x: .5, y: .5, dx: 0, dy: 0, moved: false, down: false, last: 0, px: innerWidth / 2, py: innerHeight / 2 };

addEventListener('pointermove', (e) => {
  const x = e.clientX / W(), y = 1 - e.clientY / H();
  if (pointer.moved || pointer.last) { pointer.dx += x - pointer.x; pointer.dy += y - pointer.y; }
  pointer.x = x; pointer.y = y; pointer.px = e.clientX; pointer.py = e.clientY;
  pointer.moved = true; pointer.last = performance.now();
}, { passive: true });
addEventListener('pointerdown', (e) => {
  pointer.down = true;
  if (fluid && e.target.closest('main') && !e.target.closest('a,button,input,label')) {
    const x = e.clientX / W(), y = 1 - e.clientY / H();
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      fluid.splat(x, y, Math.cos(a) * 900, Math.sin(a) * 900, pigment(2.2), .35);
    }
  }
});
addEventListener('pointerup', () => { pointer.down = false; });

// Scroll velocity feeds the skew, the header readout, the marquee and the fluid itself.
let lastScroll = scrollY, scrollDelta = 0, scrollVel = 0;
addEventListener('scroll', () => { scrollDelta += scrollY - lastScroll; lastScroll = scrollY; }, { passive: true });

function intro() {
  if (!fluid) return;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const x = .1 + .8 * (i / (n - 1)) + (Math.random() - .5) * .08;
    const y = .15 + Math.random() * .3;
    fluid.splat(x, y, (Math.random() - .5) * 1400, 900 + Math.random() * 1600, pigment(1.4 + Math.random()), .5);
    hue += .4;
  }
}

let ambientT = 0;
function feed(dt, now) {
  // Pointer: one splat per frame, carrying all motion since the last one.
  if (pointer.moved) {
    let dx = pointer.dx, dy = pointer.dy;
    const aspect = W() / H();
    if (aspect < 1) dx *= aspect; else dy /= aspect;
    const force = 6500, k = pointer.down ? 1.4 : .55;
    if (Math.abs(dx) + Math.abs(dy) > 1e-5) fluid.splat(pointer.x, pointer.y, dx * force, dy * force, pigment(k));
    pointer.dx = pointer.dy = 0; pointer.moved = false;
  }

  // Scroll: the page drags the water along with it.
  if (Math.abs(scrollDelta) > .5) {
    const d = Math.max(-120, Math.min(120, scrollDelta));
    const count = Math.min(3, 1 + Math.floor(Math.abs(d) / 40));
    for (let i = 0; i < count; i++) {
      const x = Math.random() < .5 ? .04 + Math.random() * .22 : .74 + Math.random() * .22;
      fluid.splat(x, Math.random(), (Math.random() - .5) * 200, d * 30, pigment(.12 + Math.abs(d) / 600), .3);
    }
  }

  // Ambient current so the page is never dead, louder when nobody is touching it.
  const idle = now - pointer.last > 2500;
  ambientT += dt;
  if (ambientT > (idle ? .09 : .35) && !reduced) {
    ambientT = 0;
    const t = now / 1000;
    const x = .5 + .38 * Math.sin(t * .37) * Math.cos(t * .11), y = .5 + .3 * Math.sin(t * .23 + 1.3);
    const vx = Math.cos(t * .37) * .38 * .37, vy = Math.cos(t * .23 + 1.3) * .3 * .23;
    fluid.splat(x, y, vx * 2600, vy * 2600, pigment(idle ? .3 : .1), .18);
  }
}

/* ---------------- controls ---------------- */
const fmt = (n) => n.toLocaleString('en-US');
const regimeOf = (re) => re < 2300 ? 'laminar' : re < 4000 ? 'transitional' : 'turbulent';
const fillRange = (el) => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');

const visc = $('#visc');
function applyViscosity() {
  const v = +visc.value;
  $('#visc-out').textContent = v.toFixed(2);
  const re = Math.round(10 ** (4.55 - 2.9 * v) / 10) * 10;
  $('#re-big').textContent = $('#re-read').textContent = fmt(re);
  $('#regime').textContent = regimeOf(re);
  if (fluid) {
    fluid.config.velocityDissipation = .04 + v * v * 4.5;
    fluid.config.dyeDissipation = .35 + v * 1.4;
    fluid.config.gloss = 1 + v * 1.5;
  }
  fillRange(visc);
}
visc.addEventListener('input', applyViscosity);

const curl = $('#curl');
function applyCurl() {
  $('#curl-out').textContent = curl.value;
  if (fluid) fluid.config.curl = +curl.value;
  fillRange(curl);
}
curl.addEventListener('input', applyCurl);

$('#ring').addEventListener('click', () => {
  if (!fluid) return;
  // Two counter-rotating jets side by side read as a vortex ring in cross-section.
  const x = .3 + Math.random() * .4, gap = .035;
  for (const s of [-1, 1]) fluid.splat(x + s * gap, .08, s * -120, 3800, pigment(1.6), .32);
  fluid.splat(x, .05, 0, 2600, pigment(.8), .6);
});

const swatches = $('#swatches');
for (const [name, cols] of Object.entries(PALETTES)) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.setAttribute('aria-pressed', String(cols === palette));
  const css = (c) => `rgb(${c.map((v) => Math.round(Math.min(1, 1 - Math.exp(-v * 2.2)) * 255)).join(',')})`;
  b.innerHTML = `<i>${cols.map((c) => `<b style="background:${css(c)}"></b>`).join('')}</i>${name}`;
  b.addEventListener('click', () => {
    palette = cols;
    swatches.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', String(s === b)));
    if (fluid) {
      const r = b.getBoundingClientRect();
      const x = (r.left + r.width / 2) / W(), y = 1 - (r.top + r.height / 2) / H();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        fluid.splat(x, y, Math.cos(a) * 1500, Math.sin(a) * 1500, pigment(1.5), .25);
        hue += .5;
      }
    }
  });
  swatches.append(b);
}

let stilling = 0;
$('#still').addEventListener('click', () => { stilling = 1.4; });

/* ---------------- text ---------------- */
document.querySelectorAll('[data-split]').forEach((el) => {
  let i = 0;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.append(' '); return; }
          const w = document.createElement('span');
          w.className = 'w';
          w.innerHTML = `<span style="--i:${i++}"></span>`;
          w.firstChild.textContent = part;
          frag.append(w);
        });
        child.replaceWith(frag);
      } else walk(child);
    }
  };
  el.setAttribute('aria-label', el.textContent);
  walk(el);
});

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: .2, rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('[data-split],[data-reveal]').forEach((el) => io.observe(el));

// Marquee
const track = $('#track');
const words = ['laminar', 'transitional', 'turbulent'];
track.innerHTML = Array.from({ length: 8 }, () => words.map((w) => `<span>${w}</span><span class="dot">●</span>`).join('')).join('');
let marqueeX = 0;

// Liquid type
const turb = document.querySelector('#liquid feTurbulence');
const disp = document.querySelector('#liquid feDisplacementMap');
const liquidWord = $('#liquid-word');
let liquidHover = 0, liquidTarget = 0;
liquidWord.parentElement.addEventListener('pointerenter', () => { liquidTarget = 1; });
liquidWord.parentElement.addEventListener('pointerleave', () => { liquidTarget = 0; });
liquidWord.parentElement.style.pointerEvents = 'auto';

// Goo: droplets orbiting, one tracks the cursor.
const goo = $('#drops');
const drops = Array.from({ length: 9 }, (_, i) => {
  const el = document.createElement('b');
  if (i === 0) el.className = 'c';
  goo.append(el);
  return { el, r: i === 0 ? .2 : .07 + Math.random() * .1, a: Math.random() * 6.28, sp: (.15 + Math.random() * .35) * (Math.random() < .5 ? -1 : 1), orbit: .12 + Math.random() * .24, x: .5, y: .5 };
});
const cursorDrop = { el: document.createElement('b'), r: .11, x: .5, y: .5 };
goo.append(cursorDrop.el);

// Cursor ring
const ring = $('.cursor');
let rx = innerWidth / 2, ry = innerHeight / 2;
document.addEventListener('pointerover', (e) => ring.classList.toggle('hot', !!e.target.closest('a,button,input')));

/* ---------------- loop ---------------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  scrollVel += (scrollDelta - scrollVel) * .18;
  const sv = Math.abs(scrollVel) < .01 ? 0 : scrollVel;

  if (fluid) {
    if (fluid.resize()) intro();
    if (stilling > 0) {
      stilling -= dt;
      fluid.config.dyeDissipation = 4; fluid.config.velocityDissipation = 3;
      if (stilling <= 0) applyViscosity();
    }
    const dimTarget = scrollY < innerHeight * .5 ? 1 : .58;
    fluid.config.dim += (dimTarget - fluid.config.dim) * .04;
    feed(dt, now);
    fluid.step(Math.min(dt, 1 / 60));
    fluid.render();
  }
  scrollDelta = 0;

  if (!reduced) document.documentElement.style.setProperty('--skew', `${Math.max(-6, Math.min(6, sv * .09))}deg`);
  $('#v-read').textContent = (Math.abs(sv) / 10).toFixed(2);

  marqueeX -= (60 + Math.abs(sv) * 14) * dt * (sv < -0.5 ? -1 : 1);
  const half = track.scrollWidth / 2;
  if (half) { marqueeX = ((marqueeX % half) - half) % half; track.style.transform = `translate3d(${marqueeX}px,0,0)`; }

  // Liquid type wobble: always breathing, swollen by scroll speed and hover.
  liquidHover += (liquidTarget - liquidHover) * .05;
  const t = now / 1000;
  const lr = liquidWord.getBoundingClientRect();
  if (lr.bottom > 0 && lr.top < innerHeight) {
    const amp = reduced ? 0 : 1;
    turb.setAttribute('baseFrequency', `${(.006 + Math.sin(t * .4) * .002).toFixed(4)} ${(.018 + Math.cos(t * .3) * .006 + liquidHover * .01).toFixed(4)}`);
    disp.setAttribute('scale', (amp * (22 + Math.sin(t * .9) * 8 + Math.abs(sv) * 2 + liquidHover * 50)).toFixed(1));
  }

  // Goo
  const gr = goo.getBoundingClientRect();
  if (gr.bottom > 0 && gr.top < innerHeight) {
    const size = gr.width;
    const mx = (pointer.px - gr.left) / size, my = (pointer.py - gr.top) / size;
    const near = mx > -.3 && mx < 1.3 && my > -.3 && my < 1.3;
    const tx = near ? mx : .5 + Math.cos(t * .7) * .3, ty = near ? my : .5 + Math.sin(t * 1.1) * .3;
    cursorDrop.x += (tx - cursorDrop.x) * .12; cursorDrop.y += (ty - cursorDrop.y) * .12;
    for (const d of drops) {
      d.a += d.sp * dt * (reduced ? 0 : 1);
      let tx2 = .5 + Math.cos(d.a) * d.orbit, ty2 = .5 + Math.sin(d.a * 1.3) * d.orbit;
      if (near) { tx2 += (cursorDrop.x - tx2) * .25; ty2 += (cursorDrop.y - ty2) * .25; }
      d.x += (tx2 - d.x) * .06; d.y += (ty2 - d.y) * .06;
    }
    for (const d of [...drops, cursorDrop]) {
      const px = d.r * size * 2;
      d.el.style.width = d.el.style.height = px + 'px';
      d.el.style.transform = `translate3d(${d.x * size - px / 2}px,${d.y * size - px / 2}px,0)`;
    }
  }

  rx += (pointer.px - rx) * .2; ry += (pointer.py - ry) * .2;
  ring.style.transform = `translate3d(${rx}px,${ry}px,0)`;

  requestAnimationFrame(frame);
}

applyViscosity();
applyCurl();
intro();
requestAnimationFrame(frame);
