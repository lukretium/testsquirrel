#!/usr/bin/env node
/*
 * Generates images/mr-testsquirrel-portrait.svg — the hero portrait of
 * "Mr. TestSquirrel": a red squirrel in a black suit, framed right so the
 * headline can sit over the empty left half.
 *
 * Fur is the hard part in vector: a clean bezier outline reads as plastic.
 * So the silhouette is ruffled with hundreds of generated tapering slivers
 * (seeded PRNG -> byte-identical output on every run).
 *
 *   node build/gen-hero.js
 */
const fs = require('fs');
const path = require('path');

const W = 1672, H = 941;

// ---------------------------------------------------------------- rng
let _s = 20260807;
const rnd = () => (_s = (_s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const rng = (a, b) => a + (b - a) * rnd();
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const n = v => Math.round(v * 10) / 10;

// ------------------------------------------------------------- palette
const FUR = {
  shadow: '#6d3409',
  deep: '#8f4715',
  mid: '#b45a1c',
  base: '#c96e22',
  warm: '#dd8a35',
  light: '#eda44f',
  pale: '#f6c98c',
  cream: '#fbeedb',
};
const FRINGE = [FUR.deep, FUR.mid, FUR.base, FUR.warm, FUR.light, FUR.pale];

/**
 * A fringe of tapering fur slivers pointing outward along an elliptical arc.
 * Each sliver is a two-curve teardrop so nothing reads as a hard triangle.
 */
function fringe({ cx, cy, rx, ry, a0, a1, count, len, spread = 1, colors = FRINGE, opacity = [0.55, 1], inset = 0.97 }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const a = a0 + (a1 - a0) * t + rng(-0.008, 0.008);
    const ca = Math.cos(a), sa = Math.sin(a);
    // base sits just inside the silhouette so the tuft grows out of the body
    const bx = cx + rx * inset * ca, by = cy + ry * inset * sa;
    const L = len * rng(0.55, 1.35);
    // outward direction, biased along the local ellipse normal
    const nx = ca * rng(0.85, 1.15), ny = sa * rng(0.85, 1.15);
    const tipx = bx + nx * L, tipy = by + ny * L;
    // half-width of the tuft base, perpendicular to the outward direction
    const w = L * rng(0.5, 0.85) * spread;   // wide base -> soft tuft, not a spike
    const px = -ny * w, py = nx * w;
    const skew = rng(-0.35, 0.35) * L;            // sideways lean
    const mx = bx + nx * L * 0.55 - ny * skew * 0.5;
    const my = by + ny * L * 0.55 + nx * skew * 0.5;
    out.push(
      `<path d="M${n(bx + px)} ${n(by + py)}Q${n(mx + px * 0.35)} ${n(my + py * 0.35)} ${n(tipx)} ${n(tipy)}` +
      `Q${n(mx - px * 0.35)} ${n(my - py * 0.35)} ${n(bx - px)} ${n(by - py)}Z" ` +
      `fill="${pick(colors)}" opacity="${n(rng(opacity[0], opacity[1]) * 100) / 100}"/>`
    );
  }
  return out.join('\n      ');
}

/** Fur strands laid along a spine curve — used for the tail plume. */
function plume({ spine, count, len, colors = FRINGE, side = 1, opacity = [0.5, 0.95] }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // sample the polyline spine
    const f = t * (spine.length - 1);
    const i0 = Math.floor(f), i1 = Math.min(i0 + 1, spine.length - 1), k = f - i0;
    const bx = spine[i0][0] + (spine[i1][0] - spine[i0][0]) * k;
    const by = spine[i0][1] + (spine[i1][1] - spine[i0][1]) * k;
    const dx = spine[i1][0] - spine[i0][0], dy = spine[i1][1] - spine[i0][1];
    const d = Math.hypot(dx, dy) || 1;
    // outward normal, flipped per side
    const nx = (-dy / d) * side, ny = (dx / d) * side;
    // taper the plume toward both ends
    const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * 0.65 + 0.35;
    const L = len * taper * rng(0.6, 1.25);
    const lean = rng(-0.5, 0.2);
    const tipx = bx + nx * L + (dx / d) * L * lean;
    const tipy = by + ny * L + (dy / d) * L * lean;
    const w = L * rng(0.55, 0.95);
    const px = (dx / d) * w, py = (dy / d) * w;
    const mx = bx + nx * L * 0.5, my = by + ny * L * 0.5;
    out.push(
      `<path d="M${n(bx + px)} ${n(by + py)}Q${n(mx + px * 0.4)} ${n(my + py * 0.4)} ${n(tipx)} ${n(tipy)}` +
      `Q${n(mx - px * 0.4)} ${n(my - py * 0.4)} ${n(bx - px)} ${n(by - py)}Z" ` +
      `fill="${pick(colors)}" opacity="${n(rng(opacity[0], opacity[1]) * 100) / 100}"/>`
    );
  }
  return out.join('\n      ');
}

/**
 * Closed ribbon swept along a spine with a variable half-width — the solid
 * body of the tail, so silhouette and plume always agree.
 */
function ribbon(spine, widthAt) {
  const left = [], right = [];
  for (let i = 0; i < spine.length; i++) {
    const p = spine[i];
    const a = spine[Math.max(0, i - 1)], b = spine[Math.min(spine.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    const w = widthAt(i / (spine.length - 1));
    left.push([p[0] + nx * w, p[1] + ny * w]);
    right.push([p[0] - nx * w, p[1] - ny * w]);
  }
  const smooth = pts => pts.map((p, i) => {
    if (i === 0) return `M${n(p[0])} ${n(p[1])}`;
    const q = pts[i - 1];
    return `Q${n(q[0])} ${n(q[1])} ${n((q[0] + p[0]) / 2)} ${n((q[1] + p[1]) / 2)}`;
  }).join('');
  return smooth(left) + 'L' + n(right[right.length - 1][0]) + ' ' + n(right[right.length - 1][1]) +
         smooth(right.slice().reverse()).replace(/^M[^Q]*/, '') + 'Z';
}

// ------------------------------------------------------------ geometry
const HX = 1128, HY = 372;        // head centre
const HRX = 218, HRY = 210;       // head radii
const EY = 358;                   // eye line
const EXL = 1042, EXR = 1214;     // eye centres
const MX = HX, MY = 492;          // muzzle centre

// tail spine: emerges behind the right shoulder and sweeps up and over
const TAIL = [[1360, 930], [1472, 890], [1566, 806], [1620, 688], [1626, 556], [1592, 426], [1524, 320], [1452, 250], [1392, 212]];
// half-width along the spine: thin where it meets the body, fat in the plume
const TAIL_W = t => 46 + 86 * Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.06));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Mr. TestSquirrel, a red squirrel in a black business suit">
  <defs>
    <radialGradient id="bgGlow" cx="66%" cy="34%" r="62%">
      <stop offset="0%" stop-color="#f6efe6"/>
      <stop offset="55%" stop-color="#e6dcd0"/>
      <stop offset="100%" stop-color="#cbbcab"/>
    </radialGradient>
    <radialGradient id="haloGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fffaf2" stop-opacity=".85"/>
      <stop offset="100%" stop-color="#fffaf2" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="55%" cy="42%" r="72%">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#3a2a1b" stop-opacity=".3"/>
    </radialGradient>

    <linearGradient id="headFill" x1=".18" y1=".05" x2=".9" y2="1">
      <stop offset="0%" stop-color="${FUR.light}"/>
      <stop offset="42%" stop-color="${FUR.base}"/>
      <stop offset="100%" stop-color="${FUR.deep}"/>
    </linearGradient>
    <linearGradient id="earFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${FUR.mid}"/>
      <stop offset="100%" stop-color="${FUR.base}"/>
    </linearGradient>
    <radialGradient id="earInner" cx="50%" cy="62%" r="60%">
      <stop offset="0%" stop-color="#f3cfa8"/>
      <stop offset="100%" stop-color="#c07d4a"/>
    </radialGradient>
    <linearGradient id="muzzleFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fffaf1"/>
      <stop offset="65%" stop-color="${FUR.cream}"/>
      <stop offset="100%" stop-color="#e2c8a4"/>
    </linearGradient>
    <radialGradient id="eyeBall" cx="36%" cy="30%" r="76%">
      <stop offset="0%" stop-color="#503926"/>
      <stop offset="42%" stop-color="#1d1309"/>
      <stop offset="100%" stop-color="#080401"/>
    </radialGradient>
    <linearGradient id="tailFill" x1="1" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="${FUR.deep}"/>
      <stop offset="55%" stop-color="${FUR.warm}"/>
      <stop offset="100%" stop-color="${FUR.pale}"/>
    </linearGradient>
    <linearGradient id="suit" x1=".1" y1="0" x2=".9" y2="1">
      <stop offset="0%" stop-color="#2a2b30"/>
      <stop offset="45%" stop-color="#17181c"/>
      <stop offset="100%" stop-color="#0c0d10"/>
    </linearGradient>
    <linearGradient id="lapel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#33343a"/>
      <stop offset="60%" stop-color="#1c1d22"/>
      <stop offset="100%" stop-color="#101116"/>
    </linearGradient>
    <linearGradient id="shirt" x1="0" y1="0" x2=".4" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="#f2f0ea"/>
      <stop offset="100%" stop-color="#d8d4ca"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#fff" stop-opacity="0"/>
      <stop offset="50%" stop-color="#fff" stop-opacity=".13"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>

    <filter id="blurLg" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="34"/></filter>
    <filter id="blurMd" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="blurSm" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>

  <!-- ============================ backdrop ============================ -->
  <g id="backdrop">
    <rect width="${W}" height="${H}" fill="url(#bgGlow)"/>
    <ellipse cx="${HX}" cy="${HY - 20}" rx="470" ry="400" fill="url(#haloGlow)"/>
    <rect width="${W}" height="${H}" fill="url(#vignette)"/>
    <!-- soft contact shadow under the shoulders -->
    <ellipse cx="1180" cy="905" rx="520" ry="120" fill="#4a3a2a" opacity=".18" filter="url(#blurLg)"/>
  </g>

  <!-- Character scaled toward the bottom-right corner: keeps the head clear of
       the headline that the site overlays on the left half of this image. -->
  <g id="character" transform="translate(150 0) translate(${W} ${H}) scale(.9) translate(${-W} ${-H})">

  <!-- ============================== tail ============================== -->
  <g id="tail">
    <!-- solid plume body -->
    <path d="${ribbon(TAIL, t => TAIL_W(t) + 7)}" fill="${FUR.shadow}" opacity=".9"/>
    <path d="${ribbon(TAIL, TAIL_W)}" fill="url(#tailFill)"/>
    <!-- pale streak along the inner curve, as on a real red squirrel -->
    <path d="${ribbon(TAIL.map(([x, y]) => [x - 30, y - 16]), t => TAIL_W(t) * 0.36)}"
          fill="#fde9cb" opacity=".35" filter="url(#blurMd)"/>
    <!-- fuzz breaking both contours so the plume never reads as a smooth blob -->
    <g id="tail-fur-out">
      ${plume({ spine: TAIL.map(([x, y], i) => { const w = TAIL_W(i / (TAIL.length - 1)); return [x, y]; }), count: 150, len: 150, side: 1, opacity: [0.35, 0.8] })}
    </g>
    <g id="tail-fur-in">
      ${plume({ spine: TAIL, count: 120, len: 132, side: -1, colors: [FUR.mid, FUR.base, FUR.warm, FUR.deep], opacity: [0.3, 0.7] })}
    </g>
    <!-- chunky notches along the outer edge -->
    <g id="tail-notches">
      ${plume({ spine: TAIL, count: 26, len: 190, side: 1, colors: [FUR.warm, FUR.light, FUR.pale], opacity: [0.28, 0.55] })}
    </g>
  </g>

  <!-- ============================== body ============================== -->
  <g id="body">
    <!-- neck + shoulders silhouette, bleeding off the bottom edge -->
    <path d="M${HX - 6} 560c-70 0-118 26-146 44l-150 86c-74 42-118 122-118 208v43h1088V898c0-86-44-166-118-208l-150-86c-28-18-76-44-146-44z"
          fill="url(#suit)"/>
    <!-- shoulder seams -->
    <path d="M842 941c4-96 30-166 78-212" fill="none" stroke="#2e3037" stroke-width="3" opacity=".55"/>
    <path d="M1440 941c-4-96-30-166-78-212" fill="none" stroke="#2e3037" stroke-width="3" opacity=".55"/>
    <!-- shirt -->
    <path d="M1010 604l118 96 118-96 46 26-92 311h-144l-92-311z" fill="url(#shirt)"/>
    <!-- collar points -->
    <path d="M1010 604l118 96-74 22-70-96z" fill="#eae6dd"/>
    <path d="M1246 604l-118 96 74 22 70-96z" fill="#f7f5ef"/>
    <!-- open placket shadow -->
    <path d="M1128 700l16 42-16 199-16-199z" fill="#c9c4b8" opacity=".7"/>
    <!-- notch lapels -->
    <path d="M1010 604l-96 44-46 293h96l70-266 44-45z" fill="url(#lapel)"/>
    <path d="M1246 604l96 44 46 293h-96l-70-266-44-45z" fill="url(#lapel)"/>
    <!-- lapel notch cuts -->
    <path d="M1012 660l-52 24 34 22z" fill="#0d0e12"/>
    <path d="M1244 660l52 24-34 22z" fill="#0d0e12"/>
    <!-- lapel edge highlights -->
    <path d="M1010 606l-94 44" fill="none" stroke="#4a4c55" stroke-width="3" opacity=".7"/>
    <path d="M1246 606l94 44" fill="none" stroke="#4a4c55" stroke-width="3" opacity=".7"/>
    <path d="M982 702l-68 239" fill="none" stroke="#3c3e46" stroke-width="2.5" opacity=".6"/>
    <path d="M1274 702l68 239" fill="none" stroke="#3c3e46" stroke-width="2.5" opacity=".6"/>
    <!-- fabric sheen across the left shoulder -->
    <path d="M700 941c0-92 44-172 118-214l150-86v300z" fill="url(#sheen)"/>
    <!-- chest fur spilling over the collar -->
    <path d="M1128 548c-52 0-90 22-104 56 30 30 66 46 104 46s74-16 104-46c-14-34-52-56-104-56z" fill="${FUR.cream}"/>
    <g id="bib-fur">
      ${fringe({ cx: HX, cy: 596, rx: 108, ry: 58, a0: 0.15, a1: Math.PI - 0.15, count: 78, len: 17, colors: ['#fffaf1', FUR.cream, '#eddcc0', FUR.pale], opacity: [0.6, 1] })}
    </g>
    <!-- occlusion under the chin -->
    <ellipse cx="${HX}" cy="586" rx="180" ry="62" fill="#3a2411" opacity=".28" filter="url(#blurMd)"/>
  </g>

  <!-- ============================== head ============================== -->
  <g id="head">
    <!-- ears (pointed, with the red-squirrel tuft continuous) -->
    <g id="ears">
      <!-- left -->
      <path d="M960 232c-34-58-52-118-46-168 4-32 20-40 34-16 20 34 48 78 74 118z" fill="${FUR.deep}"/>
      <path d="M966 226c-28-52-44-104-40-146 3-24 14-30 24-12 18 30 42 68 64 102z" fill="url(#earFill)"/>
      <path d="M978 214c-18-38-28-74-26-102 2-16 9-20 15-8 12 22 28 48 42 72z" fill="url(#earInner)" opacity=".85"/>
      <g>${fringe({ cx: 962, cy: 130, rx: 34, ry: 92, a0: Math.PI * 0.72, a1: Math.PI * 1.42, count: 44, len: 24, colors: [FUR.deep, FUR.mid, FUR.base, FUR.warm] })}</g>
      <!-- right -->
      <path d="M1296 232c34-58 52-118 46-168-4-32-20-40-34-16-20 34-48 78-74 118z" fill="${FUR.deep}"/>
      <path d="M1290 226c28-52 44-104 40-146-3-24-14-30-24-12-18 30-42 68-64 102z" fill="url(#earFill)"/>
      <path d="M1278 214c18-38 28-74 26-102-2-16-9-20-15-8-12 22-28 48-42 72z" fill="url(#earInner)" opacity=".85"/>
      <g>${fringe({ cx: 1294, cy: 130, rx: 34, ry: 92, a0: -Math.PI * 0.42, a1: Math.PI * 0.28, count: 44, len: 24, colors: [FUR.deep, FUR.mid, FUR.base, FUR.warm] })}</g>
    </g>

    <!-- silhouette fringe (drawn under the face fill) -->
    <g id="head-fringe">
      ${fringe({ cx: HX, cy: HY, rx: HRX, ry: HRY, a0: -Math.PI * 0.96, a1: Math.PI * 0.96, count: 240, len: 26, opacity: [0.6, 1] })}
    </g>

    <!-- skull -->
    <ellipse cx="${HX}" cy="${HY}" rx="${HRX}" ry="${HRY}" fill="${FUR.deep}"/>
    <ellipse cx="${HX}" cy="${HY}" rx="${HRX - 3}" ry="${HRY - 3}" fill="url(#headFill)"/>
    <!-- forehead light + jaw shadow give the head volume -->
    <ellipse cx="1090" cy="270" rx="150" ry="105" fill="#f4ad5c" opacity=".38" filter="url(#blurMd)"/>
    <ellipse cx="1200" cy="500" rx="160" ry="90" fill="#6d3409" opacity=".3" filter="url(#blurMd)"/>
    <!-- short fur strokes over the skull for texture -->
    <g id="head-texture" opacity=".5">
      ${fringe({ cx: HX, cy: HY, rx: HRX - 46, ry: HRY - 46, a0: -Math.PI, a1: Math.PI, count: 130, len: 22, inset: 1, colors: [FUR.mid, FUR.warm, FUR.light, FUR.deep], opacity: [0.18, 0.5] })}
    </g>

    <!-- brow / cheek cream patches -->
    <ellipse cx="1024" cy="290" rx="58" ry="30" fill="${FUR.cream}" opacity=".5" transform="rotate(-15 1024 290)" filter="url(#blurSm)"/>
    <ellipse cx="1232" cy="290" rx="58" ry="30" fill="${FUR.cream}" opacity=".5" transform="rotate(15 1232 290)" filter="url(#blurSm)"/>

    <!-- eyes -->
    <g id="eyes">
      <ellipse cx="${EXL}" cy="${EY}" rx="62" ry="64" fill="#3a2410" opacity=".55" filter="url(#blurSm)"/>
      <ellipse cx="${EXR}" cy="${EY}" rx="62" ry="64" fill="#3a2410" opacity=".55" filter="url(#blurSm)"/>
      <ellipse cx="${EXL}" cy="${EY}" rx="55" ry="57" fill="url(#eyeBall)"/>
      <ellipse cx="${EXR}" cy="${EY}" rx="55" ry="57" fill="url(#eyeBall)"/>
      <!-- speculars -->
      <circle cx="${EXL - 20}" cy="${EY - 24}" r="17" fill="#fff" opacity=".96"/>
      <circle cx="${EXR - 20}" cy="${EY - 24}" r="17" fill="#fff" opacity=".96"/>
      <circle cx="${EXL + 20}" cy="${EY + 22}" r="8" fill="#bfe4ff" opacity=".5"/>
      <circle cx="${EXR + 20}" cy="${EY + 22}" r="8" fill="#bfe4ff" opacity=".5"/>
      <!-- lower lid catchlight -->
      <path d="M${EXL - 44} ${EY + 34}q44 30 88 0" fill="none" stroke="#e8b877" stroke-width="4" opacity=".45"/>
      <path d="M${EXR - 44} ${EY + 34}q44 30 88 0" fill="none" stroke="#e8b877" stroke-width="4" opacity=".45"/>
      <!-- upper lid, slightly lowered = deadpan look -->
      <path d="M${EXL - 56} ${EY - 30}q56 -34 112 -6l-4 -22q-56 -22 -110 8z" fill="${FUR.deep}"/>
      <path d="M${EXR - 56} ${EY - 36}q56 -28 112 6l4 -22q-58 -30 -112 -6z" fill="${FUR.deep}"/>
    </g>

    <!-- muzzle -->
    <g id="muzzle">
      <g opacity=".95">
        ${fringe({ cx: MX, cy: MY, rx: 112, ry: 84, a0: -Math.PI, a1: Math.PI, count: 96, len: 13, colors: ['#fffaf1', FUR.cream, '#ecd9ba'], opacity: [0.5, 0.95] })}
      </g>
      <ellipse cx="${MX}" cy="${MY}" rx="112" ry="84" fill="url(#muzzleFill)"/>
      <!-- cheek separation -->
      <path d="M${MX} ${MY - 18}q-6 40 -4 66" fill="none" stroke="#d9bd95" stroke-width="3" opacity=".6"/>
      <!-- nose -->
      <path d="M${MX} 424c26 0 44 14 44 30s-20 26-44 26-44-10-44-26 18-30 44-30z" fill="#2b1a0e"/>
      <ellipse cx="${MX - 14}" cy="436" rx="12" ry="7" fill="#6b4a33" opacity=".7"/>
      <path d="M${MX} 480v26" stroke="#2b1a0e" stroke-width="7" stroke-linecap="round"/>
      <!-- smirk -->
      <path d="M${MX - 46} 508q46 34 92 0" fill="none" stroke="#2b1a0e" stroke-width="7" stroke-linecap="round"/>
      <!-- chisel incisors -->
      <rect x="${MX - 24}" y="524" width="22" height="34" rx="6" fill="#fffdf6"/>
      <rect x="${MX + 2}" y="524" width="22" height="34" rx="6" fill="#f0e9d8"/>
      <path d="M${MX - 26} 524h52" stroke="#c9b596" stroke-width="3"/>
    </g>

    <!-- whiskers -->
    <g id="whiskers" stroke="#fdf3e2" fill="none" stroke-linecap="round" opacity=".75">
      <path d="M1012 470q-98 -30 -170 -74" stroke-width="5"/>
      <path d="M1010 492q-104 -6 -180 12" stroke-width="4.5"/>
      <path d="M1016 514q-96 22 -160 62" stroke-width="4"/>
      <path d="M1244 470q98 -30 170 -74" stroke-width="5" opacity=".55"/>
      <path d="M1246 492q104 -6 180 12" stroke-width="4.5" opacity=".55"/>
      <path d="M1240 514q96 22 160 62" stroke-width="4" opacity=".5"/>
    </g>

    <!-- rim light down the right of the head -->
    <path d="M1320 250c34 44 44 108 26 166-16 52-50 96-96 124 62-22 106-72 122-134 16-62 4-124-52-156z"
          fill="#ffe3b8" opacity=".5" filter="url(#blurSm)"/>
  </g>

  </g><!-- /character -->
</svg>
`;

const outPath = path.join(__dirname, '..', 'images', 'mr-testsquirrel-portrait.svg');
fs.writeFileSync(outPath, svg);
console.log('wrote', outPath, (svg.length / 1024).toFixed(1) + ' KB');
