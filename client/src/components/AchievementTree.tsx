import React, { useEffect } from "react";
import { getPointsForProject, getPoints, fetchProjectPoints, fetchProjectDecayStatus } from "../lib/gamification";

const STAGES = [
  { key: "seed", threshold: 0, label: "Seed" },
  { key: "sprout", threshold: 10, label: "Sprout" },
  { key: "sapling", threshold: 40, label: "Sapling" },
  { key: "tree", threshold: 120, label: "Tree" },
  { key: "flowering", threshold: 300, label: "Flowering" },
  { key: "fruiting", threshold: 600, label: "Fruiting" },
];

import { getProjectDecayStatus } from "../lib/gamification";
import { useWebSocket } from "../hooks/useWebSocket";

function computeStage(p: number) {
  let s = STAGES[0];
  for (const st of STAGES) if (p >= st.threshold) s = st;
  return s;
}

function rng(seed: number) {
  let s = ((seed ^ 0xdeadbeef) >>> 0);
  s = (Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0);
  s = (Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0);
  return ((s ^ (s >>> 16)) >>> 0) / 0xffffffff;
}

/* ══════════════════════════════════════════════════════
   NATURAL TREE BRANCH SYSTEM
══════════════════════════════════════════════════════ */
function buildTree(cx: number, baseY: number, levels = 5, decayStatus = 'active') {
  const branches: any[] = [];
  let id = 0;

  function grow(x1: number, y1: number, angle: number, len: number, thick: number, lv: number) {
    if (lv > levels || len < 4 || thick < 0.6) return;
    const rad = (angle * Math.PI) / 180;

    let currentAngle = angle;
    if (decayStatus === 'dying' && lv > 1) currentAngle -= 15;
    if (decayStatus === 'wilting' && lv > 2) currentAngle -= 8;

    const bendAmt = (rng(id * 7 + 1) - 0.5) * len * 0.22;
    const cpx = x1 + Math.cos(rad) * len * 0.5 + Math.cos(rad + Math.PI / 2) * bendAmt;
    const cpy = y1 - Math.sin(rad) * len * 0.5 + Math.sin(rad + Math.PI / 2) * bendAmt;
    const x2 = x1 + Math.cos(rad) * len;
    const y2 = y1 - Math.sin(rad) * len;
    const myId = id++;
    branches.push({ id: myId, x1, y1, x2, y2, cpx, cpy, thick, lv });

    const spread = 22 + rng(myId * 3 + 2) * 26;
    const sway = (rng(myId * 5 + 3) - 0.5) * 14;
    const lm = 0.60 + rng(myId * 11) * 0.16;

    grow(x2, y2, currentAngle + spread + sway, len * lm, thick * 0.62, lv + 1);
    grow(x2, y2, currentAngle - spread + sway * 0.7, len * lm * (0.84 + rng(myId * 17) * 0.20), thick * 0.62, lv + 1);
    if (lv <= 3 && rng(myId * 19) > 0.38)
      grow(x2, y2, currentAngle + (rng(myId * 23) - 0.5) * 16, len * lm * 0.66, thick * 0.55, lv + 2);
  }

  grow(cx, baseY, 88, 100, 28, 1);
  grow(cx - 4, baseY - 80, 125, 72, 19, 1);
  grow(cx + 4, baseY - 75, 55, 70, 18, 1);
  return branches;
}

function getTips(branches: any[], minLv: number) {
  return branches.filter(b => b.lv >= minLv).map(b => ({ x: b.x2, y: b.y2, id: b.id }));
}

function Defs() {
  return (
    <defs>
      <linearGradient id="dSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#9ecfff" />
        <stop offset="45%" stopColor="#cce8ff" />
        <stop offset="100%" stopColor="#e8fff4" />
      </linearGradient>
      <linearGradient id="dWiltingSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#d1d5db" />
        <stop offset="100%" stopColor="#f3f4f6" />
      </linearGradient>
      <linearGradient id="dLeafWilting" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#d97706" />
        <stop offset="100%" stopColor="#92400e" />
      </linearGradient>
      <linearGradient id="dLeafDying" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#78350f" />
        <stop offset="100%" stopColor="#451a03" />
      </linearGradient>
      <linearGradient id="dBlossomSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#b0d8ff" />
        <stop offset="50%" stopColor="#dbeeff" />
        <stop offset="100%" stopColor="#edfff8" />
      </linearGradient>
      <radialGradient id="dGround" cx="50%" cy="20%">
        <stop offset="0%" stopColor="#8ae058" />
        <stop offset="55%" stopColor="#4db825" />
        <stop offset="100%" stopColor="#267010" />
      </radialGradient>
      <radialGradient id="dSoil" cx="45%" cy="35%">
        <stop offset="0%" stopColor="#c08848" />
        <stop offset="100%" stopColor="#5a2e0c" />
      </radialGradient>
      <linearGradient id="dBark" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#180800" />
        <stop offset="14%" stopColor="#4a1e08" />
        <stop offset="38%" stopColor="#8a4c20" />
        <stop offset="60%" stopColor="#6a3210" />
        <stop offset="84%" stopColor="#3c1a06" />
        <stop offset="100%" stopColor="#180800" />
      </linearGradient>
      <linearGradient id="dBarkHL" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="rgba(200,135,75,0)" />
        <stop offset="42%" stopColor="rgba(200,135,75,0.30)" />
        <stop offset="100%" stopColor="rgba(200,135,75,0)" />
      </linearGradient>
      <linearGradient id="dRoot" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#2a1004" />
        <stop offset="50%" stopColor="#6a3a14" />
        <stop offset="100%" stopColor="#2a1004" />
      </linearGradient>
      <radialGradient id="pA" cx="35%" cy="28%">
        <stop offset="0%" stopColor="#fff0f5" />
        <stop offset="35%" stopColor="#ffc8e0" />
        <stop offset="75%" stopColor="#ff8cbd" />
        <stop offset="100%" stopColor="#ff60a8" />
      </radialGradient>
      <radialGradient id="pB" cx="35%" cy="28%">
        <stop offset="0%" stopColor="#fff5f8" />
        <stop offset="35%" stopColor="#ffd8ea" />
        <stop offset="75%" stopColor="#ffaace" />
        <stop offset="100%" stopColor="#ff88ba" />
      </radialGradient>
      <radialGradient id="pC" cx="35%" cy="28%">
        <stop offset="0%" stopColor="#fff8fa" />
        <stop offset="35%" stopColor="#ffe4f0" />
        <stop offset="75%" stopColor="#ffc8e0" />
        <stop offset="100%" stopColor="#ffaad0" />
      </radialGradient>
      <linearGradient id="dLeaf" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#72e038" />
        <stop offset="100%" stopColor="#206808" />
      </linearGradient>
      <radialGradient id="fRed" cx="30%" cy="26%">
        <stop offset="0%" stopColor="#ff9898" />
        <stop offset="42%" stopColor="#dd1818" />
        <stop offset="100%" stopColor="#780606" />
      </radialGradient>
      <radialGradient id="fGold" cx="30%" cy="26%">
        <stop offset="0%" stopColor="#ffec98" />
        <stop offset="42%" stopColor="#e08818" />
        <stop offset="100%" stopColor="#784808" />
      </radialGradient>
      <radialGradient id="fDark" cx="30%" cy="26%">
        <stop offset="0%" stopColor="#d07898" />
        <stop offset="42%" stopColor="#96183c" />
        <stop offset="100%" stopColor="#4e0818" />
      </radialGradient>
      <radialGradient id="dPinkGlow" cx="50%" cy="48%">
        <stop offset="0%" stopColor="#ffc0e0" stopOpacity="0.22" />
        <stop offset="100%" stopColor="#ffc0e0" stopOpacity="0" />
      </radialGradient>
      {/* Key-step fruit gradients (NEW) */}
      <radialGradient id="fKeyGreen" cx="30%" cy="26%">
        <stop offset="0%" stopColor="#bbf7d0" />
        <stop offset="42%" stopColor="#22c55e" />
        <stop offset="100%" stopColor="#14532d" />
      </radialGradient>
      <radialGradient id="fKeyYellow" cx="30%" cy="26%">
        <stop offset="0%" stopColor="#fef3c7" />
        <stop offset="42%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#78350f" />
      </radialGradient>
      <radialGradient id="fKeyRed" cx="30%" cy="26%">
        <stop offset="0%" stopColor="#fecaca" />
        <stop offset="42%" stopColor="#dc2626" />
        <stop offset="100%" stopColor="#7f1d1d" />
      </radialGradient>
    </defs>
  );
}

function Sky({ w, h, bloom = false, skyId = 'dSky' }: { w: number, h: number, bloom?: boolean, skyId?: string }) {
  return (
    <>
      <rect width={w} height={h} fill={bloom ? "url(#dBlossomSky)" : `url(#${skyId})`} rx="14" />
      <circle cx={w - 62} cy={48} r={26} fill="#fff8a0" opacity="0.88" />
      <circle cx={w - 62} cy={48} r={18} fill="#ffe828" />
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a, i) => {
        const r = (a * Math.PI) / 180;
        return <line key={i}
          x1={(w - 62) + Math.cos(r) * 22} y1={48 + Math.sin(r) * 22}
          x2={(w - 62) + Math.cos(r) * 35} y2={48 + Math.sin(r) * 35}
          stroke="#ffe020" strokeWidth="1.8" opacity="0.60" />;
      })}
      {[[70, 50, 1.1], [138, 40, 0.86], [48, 66, 0.70], [w - 158, 56, 1.0], [w - 105, 44, 0.80]].map(([cx, cy, s], i) => (
        <g key={i} opacity={0.88}>
          <ellipse cx={cx} cy={cy} rx={46 * s} ry={17 * s} fill="white" />
          <ellipse cx={cx - 22 * s} cy={cy + 5 * s} rx={30 * s} ry={14 * s} fill="white" />
          <ellipse cx={cx + 22 * s} cy={cy + 3 * s} rx={34 * s} ry={13 * s} fill="white" />
        </g>
      ))}
    </>
  );
}

function Ground({ w, h, cx }: { w: number, h: number, cx: number }) {
  return (
    <>
      <ellipse cx={cx} cy={h - 18} rx={w * 0.55} ry={40} fill="url(#dGround)" />
      <ellipse cx={cx} cy={h - 12} rx={w * 0.44} ry={26} fill="#58c030" opacity="0.40" />
      <ellipse cx={cx} cy={h - 26} rx={70} ry={20} fill="url(#dSoil)" />
      <ellipse cx={cx} cy={h - 22} rx={56} ry={12} fill="#7a4820" opacity="0.30" />
      {Array.from({ length: 36 }, (_, i) => {
        const gx = cx - 175 + i * 10 + rng(i * 3) * 7;
        const gy = h - 28;
        const bh = 8 + rng(i * 7) * 14;
        return <path key={i}
          d={`M${gx},${gy} Q${gx + (rng(i * 5) * 5 - 2.5)},${gy - bh * .5} ${gx + (rng(i * 11) * 3 - 1.5)},${gy - bh}`}
          stroke="#3a9c18" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.68" />;
      })}
    </>
  );
}

function Branches({ branches }: { branches: any[] }) {
  return (
    <g>
      {branches.map(b => {
        const t = b.thick;
        const d = `M${b.x1},${b.y1} Q${b.cpx},${b.cpy} ${b.x2},${b.y2}`;
        return (
          <g key={b.id}>
            <path d={d} stroke="#0e0300" strokeWidth={t * 1.28} strokeLinecap="round" fill="none" opacity="0.40" />
            <path d={d} stroke="url(#dBark)" strokeWidth={t} strokeLinecap="round" fill="none" />
            {t > 3 && <path d={d} stroke="url(#dBarkHL)" strokeWidth={t * 0.24} strokeLinecap="round" fill="none" />}
            {t > 9 && <path d={d} stroke="#0a0200" strokeWidth={1.0} strokeLinecap="round" fill="none" opacity="0.18" strokeDasharray="4 9" />}
          </g>
        );
      })}
    </g>
  );
}

function SurfaceRoots({ cx, y }: { cx: number; y: number }) {
  return (
    <g>
      {[-1, 1].map((d, i) => (
        <path key={i}
          d={`M${cx + d * 10},${y - 4} Q${cx + d * 60},${y + 8} ${cx + d * 112},${y + 2}`}
          stroke="#2e1404" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.55" />
      ))}
    </g>
  );
}

function LeafCluster({ x, y, sz = 14, decayStatus = 'active' }: { x: number; y: number; sz?: number; decayStatus?: string }) {
  const leafFill = (i: number) => {
    if (decayStatus === 'dying') return 'url(#dLeafDying)';
    if (decayStatus === 'wilting') return 'url(#dLeafWilting)';
    return `hsl(${108 + rng(i * 3 + 1) * 30},62%,${28 + rng(i * 5) * 15}%)`;
  };

  return (
    <g>
      {[0, 52, 108, 162, 220, 278, 334].map((a, i) => {
        const dist = sz * (0.60 + rng(i * 7) * 0.55);
        const rad = (a * Math.PI) / 180;
        const lx = x + Math.cos(rad) * dist * 0.85;
        const ly = y + Math.sin(rad) * dist * 0.52;
        return (
          <ellipse key={i}
            cx={lx} cy={ly}
            rx={sz * 0.56} ry={sz * 0.30}
            transform={`rotate(${a + 22},${lx},${ly})`}
            fill={leafFill(i)}
            opacity={0.82 + rng(i * 11) * 0.18} />
        );
      })}
    </g>
  );
}

function CherryFlower({ x, y, sz, delay, shade, rot = 0, decayStatus = 'active' }: { x: number; y: number; sz: number; delay: number; shade: number; rot?: number; decayStatus?: string }) {
  let outerCol = ["#f06090", "#f585a8", "#f9a8c4"][shade];
  let midCol = ["#f8b0cc", "#fac8da", "#fcdde8"][shade];
  let innerCol = ["#fff0f5", "#fff5f8", "#fff8fa"][shade];
  let veinCol = ["#d04070", "#e06088", "#e878a0"][shade];

  if (decayStatus === 'dying') {
    outerCol = "#5a3a2a";
    midCol = "#6a4a3a";
    innerCol = "#4a2a1a";
    veinCol = "#3a1a0a";
  } else if (decayStatus === 'wilting') {
    outerCol = "#a88a7a";
    midCol = "#b89a8a";
    innerCol = "#8a6a5a";
    veinCol = "#6a4a3a";
  }

  return (
    <g style={{
      animation: `flSway ${2.6 + delay}s ease-in-out ${delay}s infinite alternate`,
      transformOrigin: `${x}px ${y}px`,
    }}>
      {[0, 72, 144, 216, 288].map((baseA, pi) => {
        const a = baseA + rot;
        const rad = (a * Math.PI) / 180;
        const px = x + Math.cos(rad) * sz * 0.78;
        const py = y + Math.sin(rad) * sz * 0.78;

        return (
          <g key={pi}>
            <ellipse cx={px} cy={py}
              rx={sz * 0.85} ry={sz * 0.58}
              transform={`rotate(${a + 90},${px},${py})`}
              fill={outerCol} opacity="0.96" />
            <ellipse cx={px - Math.cos(rad) * sz * 0.12} cy={py - Math.sin(rad) * sz * 0.12}
              rx={sz * 0.62} ry={sz * 0.40}
              transform={`rotate(${a + 90},${px - Math.cos(rad) * sz * 0.12},${py - Math.sin(rad) * sz * 0.12})`}
              fill={midCol} opacity="0.80" />
            <ellipse cx={x + Math.cos(rad) * sz * 0.22} cy={y + Math.sin(rad) * sz * 0.22}
              rx={sz * 0.30} ry={sz * 0.20}
              transform={`rotate(${a + 90},${x + Math.cos(rad) * sz * 0.22},${y + Math.sin(rad) * sz * 0.22})`}
              fill={innerCol} opacity="0.70" />
            <line
              x1={x + Math.cos(rad) * sz * 0.16} y1={y + Math.sin(rad) * sz * 0.16}
              x2={x + Math.cos(rad) * sz * 1.48} y2={y + Math.sin(rad) * sz * 1.48}
              stroke={veinCol} strokeWidth={sz * 0.055} strokeLinecap="round" opacity="0.38" />
            {[-22, 22].map((dv, vi) => {
              const vr = ((a + dv) * Math.PI) / 180;
              return <line key={vi}
                x1={x + Math.cos(rad) * sz * 0.28} y1={y + Math.sin(rad) * sz * 0.28}
                x2={x + Math.cos(rad) * sz * 0.28 + Math.cos(vr) * sz * 0.58}
                y2={y + Math.sin(rad) * sz * 0.28 + Math.sin(vr) * sz * 0.58}
                stroke={veinCol} strokeWidth={sz * 0.04} strokeLinecap="round" opacity="0.24" />;
            })}
            <circle cx={x + Math.cos(rad) * sz * 1.55} cy={y + Math.sin(rad) * sz * 1.55}
              r={sz * 0.10} fill={outerCol} opacity="0.60" />
          </g>
        );
      })}

      <circle cx={x} cy={y} r={sz * 0.34} fill="#aadd30" opacity="0.90" />
      <circle cx={x} cy={y} r={sz * 0.22} fill="#ccee60" opacity="0.95" />
      <circle cx={x} cy={y} r={sz * 0.12} fill="#eeff88" />
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a, si) => {
        const rad = (a * Math.PI) / 180;
        const r1 = sz * 0.22, r2 = sz * 0.48;
        return (
          <g key={si}>
            <line
              x1={x + Math.cos(rad) * r1} y1={y + Math.sin(rad) * r1}
              x2={x + Math.cos(rad) * r2} y2={y + Math.sin(rad) * r2}
              stroke="#c89020" strokeWidth={sz * 0.055} strokeLinecap="round" opacity="0.75" />
            <circle cx={x + Math.cos(rad) * r2} cy={y + Math.sin(rad) * r2}
              r={sz * 0.075} fill="#ffaa00" opacity="0.90" />
          </g>
        );
      })}
    </g>
  );
}

function LeafSprig({ x, y, sz, rot = 0, decayStatus = 'active' }: { x: number; y: number; sz: number; rot?: number; decayStatus?: string }) {
  const r = (rot * Math.PI) / 180;
  const leafFill = (i: number) => {
    if (decayStatus === 'dying') return "#4a2a1a";
    if (decayStatus === 'wilting') return "#8a6a5a";
    return `hsl(${116 + i * 10},65%,${30 + i * 6}%)`;
  };
  return (
    <g>
      {[-1, 0, 1].map((side, i) => {
        const a = rot + side * 40;
        const ar = (a * Math.PI) / 180;
        const lx = x + Math.cos(ar) * sz * 0.9;
        const ly = y + Math.sin(ar) * sz * 0.9;
        return (
          <g key={i}>
            <ellipse cx={lx} cy={ly}
              rx={sz * 0.55} ry={sz * 0.26}
              transform={`rotate(${a + 90},${lx},${ly})`}
              fill={leafFill(i)} opacity="0.88" />
            <line x1={x + Math.cos(ar) * sz * 0.15} y1={y + Math.sin(ar) * sz * 0.15}
              x2={lx} y2={ly}
              stroke={decayStatus !== 'active' ? "#2e1404" : "#226808"} strokeWidth={sz * 0.09} strokeLinecap="round" opacity="0.45" />
          </g>
        );
      })}
    </g>
  );
}

function Fruit({ x, y, r, delay, v, decayStatus = 'active' }: { x: number; y: number; r: number; delay: number; v: number; decayStatus?: string }) {
  const gId = decayStatus === 'dying' ? 'dLeafDying' : decayStatus === 'wilting' ? 'dLeafWilting' : ["fRed", "fGold", "fDark"][v % 3];
  return (
    <g style={{ animation: `frBob ${2.2 + delay}s ease-in-out ${delay}s infinite alternate` }}>
      <ellipse cx={x} cy={y + r * 1.12} rx={r * 0.65} ry={r * 0.16} fill="rgba(0,0,0,0.16)" />
      <circle cx={x} cy={y} r={r} fill={decayStatus === 'active' ? `url(#${gId})` : `url(#${gId})`} />
      <ellipse cx={x - r * .28} cy={y - r * .26} rx={r * .32} ry={r * .22}
        fill="white" opacity="0.42" transform={`rotate(-25,${x - r * .28},${y - r * .26})`} />
      <ellipse cx={x} cy={y - r * .88} rx={r * .15} ry={r * .10} fill="rgba(0,0,0,0.18)" />
      <path d={`M${x + 1},${y - r} Q${x + r * .5},${y - r * 1.6} ${x + r * .2},${y - r * 1.9}`}
        stroke="#3a2006" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <ellipse cx={x + r * .44} cy={y - r * 1.54} rx={r * .42} ry={r * .20}
        transform={`rotate(-38,${x + r * .44},${y - r * 1.54})`} fill="#2e9810" opacity="0.85" />
    </g>
  );
}

/* ══ KEY-STEP FRUIT (NEW) ══
   Renders a fruit on the tree that represents a project Key Step.
   - status: 'completed' → green with green check overlay
   - status: 'pending'   → yellow/orange
   - status: 'overdue'   → red with optional warning emoji
*/
export interface KeyStepFruitData {
  id: string;
  name: string;
  status: 'completed' | 'pending' | 'overdue';
}

function KeyStepFruit({ x, y, r, delay, status, decayStatus = 'active' }: { x: number; y: number; r: number; delay: number; status: 'completed' | 'pending' | 'overdue'; decayStatus?: string }) {
  const gId =
    status === 'completed' ? 'fKeyGreen'
    : status === 'overdue' ? 'fKeyRed'
    : 'fKeyYellow';

  const ringColor =
    status === 'completed' ? '#22c55e'
    : status === 'overdue' ? '#dc2626'
    : '#f59e0b';

  return (
    <g style={{ animation: `frBob ${2.0 + delay}s ease-in-out ${delay}s infinite alternate` }}>
      {/* Shadow */}
      <ellipse cx={x} cy={y + r * 1.12} rx={r * 0.65} ry={r * 0.16} fill="rgba(0,0,0,0.16)" />
      {/* Fruit body */}
      <circle cx={x} cy={y} r={r} fill={`url(#${gId})`} stroke={ringColor} strokeWidth="1.5" />
      {/* Highlight */}
      <ellipse cx={x - r * .28} cy={y - r * .26} rx={r * .32} ry={r * .22}
        fill="white" opacity="0.45" transform={`rotate(-25,${x - r * .28},${y - r * .26})`} />
      {/* Stem */}
      <path d={`M${x + 1},${y - r} Q${x + r * .5},${y - r * 1.6} ${x + r * .2},${y - r * 1.9}`}
        stroke="#3a2006" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      {/* Leaf */}
      <ellipse cx={x + r * .44} cy={y - r * 1.54} rx={r * .42} ry={r * .20}
        transform={`rotate(-38,${x + r * .44},${y - r * 1.54})`} fill="#2e9810" opacity="0.85" />
      {/* Status indicator inside the fruit */}
      {status === 'completed' && (
        <g>
          <path
            d={`M${x - r * 0.35},${y} L${x - r * 0.05},${y + r * 0.30} L${x + r * 0.40},${y - r * 0.30}`}
            stroke="white"
            strokeWidth={Math.max(1.4, r * 0.18)}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>
      )}
      {status === 'pending' && (
        <g>
          <circle cx={x} cy={y} r={r * 0.22} fill="white" opacity="0.95" />
        </g>
      )}
      {status === 'overdue' && (
        <g>
          {/* Warning triangle inside */}
          <path
            d={`M${x},${y - r * 0.30} L${x + r * 0.32},${y + r * 0.22} L${x - r * 0.32},${y + r * 0.22} Z`}
            fill="white"
            opacity="0.95"
          />
          <text
            x={x}
            y={y + r * 0.18}
            textAnchor="middle"
            fontSize={r * 0.5}
            fontWeight="900"
            fill="#dc2626"
          >!</text>
          {/* Warning emoji outside the fruit */}
          <text
            x={x + r * 0.55}
            y={y - r * 0.55}
            fontSize={r * 0.8}
            aria-hidden
          >⚠️</text>
          <text
            x={x - r * 0.55}
            y={y - r * 0.55}
            fontSize={r * 0.7}
            aria-hidden
          >😟</text>
        </g>
      )}
    </g>
  );
}
function Confetti({ active }: { active: boolean }) {
  const pieces = React.useRef(
    Array.from({ length: 55 }, (_, i) => ({
      id: i, x: 4 + rng(i * 3) * 92,
      color: ["#ff6eb4", "#ffe066", "#7ecbff", "#b8f7a0", "#ff9966", "#c084fc", "#ff4444", "#44ddff"][i % 8],
      size: 6 + rng(i * 7) * 10, delay: rng(i * 11) * 0.9,
      dur: 1.5 + rng(i * 13) * 1.1, rotate: rng(i * 17) * 360,
      drift: -65 + rng(i * 19) * 130, shape: i % 3,
    }))
  ).current;
  if (!active) return null;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 20 }}>
      {pieces.map(p => (
        <div key={p.id} style={{
          position: "absolute", left: `${p.x}%`, top: "-7%",
          width: p.shape === 2 ? p.size * 0.4 : p.size, height: p.shape === 2 ? p.size * 2.4 : p.size,
          background: p.color, borderRadius: p.shape === 0 ? "50%" : "2px",
          animation: `cfFall ${p.dur}s ${p.delay}s ease-in forwards`,
          transform: `rotate(${p.rotate}deg)`,
          // @ts-ignore
          "--drift": `${p.drift}px`,
        } as any} />
      ))}
    </div>
  );
}

function FallingPetals({ active }: { active: boolean }) {
  const petals = React.useRef(
    Array.from({ length: 24 }, (_, i) => ({
      id: i, x: 3 + rng(i * 3) * 94,
      delay: rng(i * 7) * 7, dur: 5 + rng(i * 11) * 4,
      size: 8 + rng(i * 13) * 9, drift: -60 + rng(i * 17) * 120,
    }))
  ).current;
  if (!active) return null;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 10 }}>
      {petals.map(p => (
        <div key={p.id} style={{
          position: "absolute", left: `${p.x}%`, top: "-5%",
          width: p.size, height: p.size * 0.65,
          background: "radial-gradient(ellipse at 38% 30%, white 8%, #ffbbd5 55%, #ff85b5 100%)",
          borderRadius: "52% 48% 55% 45% / 55% 45% 55% 45%",
          transform: "rotate(-25deg)",
          animation: `ptFall ${p.dur}s ${p.delay}s ease-in-out infinite`,
          // @ts-ignore
          "--drift": `${p.drift}px`,
        } as any} />
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   STAGE TREES
   - keySteps is a NEW prop: array of key step fruits to overlay.
══════════════════════════════════════════════════════ */
function SeedTree({ keySteps = [] }: { keySteps?: KeyStepFruitData[] }) {
  return (
    <svg viewBox="0 0 560 430" style={{ width: "100%", height: "100%" }}>
      <Defs /><Sky w={560} h={430} /><Ground w={560} h={430} cx={280} />
      <ellipse cx="280" cy="374" rx="38" ry="20" fill="url(#dSoil)" />
      <ellipse cx="284" cy="364" rx="20" ry="14" fill="#aa7030" />
      <ellipse cx="278" cy="358" rx="7" ry="5" fill="#cc9848" opacity="0.5" />
      <path d="M280,355 Q287,342 283,332" stroke="#4a8018" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M283,339 Q293,333 299,337" stroke="#3a6a10" strokeWidth="2" strokeLinecap="round" fill="none" />
      {keySteps.slice(0, 1).map((ks, i) => (
        <g key={`ks${i}`}>
          <KeyStepFruit x={280 + (i % 2 === 0 ? -8 : 8)} y={340} r={4} delay={i * 0.4} status={ks.status} />
        </g>
      ))}
    </svg>
  );
}

function SproutTree({ keySteps = [] }: { keySteps?: KeyStepFruitData[] }) {
  return (
    <svg viewBox="0 0 560 430" style={{ width: "100%", height: "100%" }}>
      <Defs /><Sky w={560} h={430} /><Ground w={560} h={430} cx={280} />
      <ellipse cx="280" cy="374" rx="52" ry="22" fill="url(#dSoil)" />
      <path d="M280,372 Q278,335 280,298" stroke="#5a9020" strokeWidth="9" strokeLinecap="round" fill="none" />
      <path d="M280,344 Q250,320 238,329 Q248,350 280,344Z" fill="#48901a" />
      <path d="M280,322 Q308,298 322,308 Q310,328 280,322Z" fill="#5aaa22" />
      <ellipse cx="280" cy="296" rx="8" ry="10" fill="#72cc2e" />
      {keySteps.slice(0, 2).map((ks, i) => (
        <g key={`ks${i}`}>
          <KeyStepFruit x={280 + (i % 2 === 0 ? -14 : 14)} y={300 + (i * 4)} r={4} delay={i * 0.4} status={ks.status} />
        </g>
      ))}
    </svg>
  );
}

function SaplingTree({ decayStatus = 'active', keySteps = [] }: { decayStatus?: string; keySteps?: KeyStepFruitData[] }) {
  const cx = 280, baseY = 378;
  const branches = React.useMemo(() => buildTree(cx, baseY, 3, decayStatus), [decayStatus]);
  const tips = getTips(branches, 3);
  return (
    <svg viewBox="0 0 560 430" style={{ width: "100%", height: "100%" }}>
      <Defs /><Sky w={560} h={430} skyId={decayStatus !== 'active' ? 'dWiltingSky' : 'dSky'} /><Ground w={560} h={430} cx={cx} />
      <Branches branches={branches} />
      {tips.map((t, i) => <LeafCluster key={i} x={t.x} y={t.y} sz={13 + rng(i * 3) * 6} decayStatus={decayStatus} />)}
      {keySteps.slice(0, 3).map((ks, i) => {
        const t = tips[i % Math.max(1, tips.length)] || { x: cx, y: baseY - 50 };
        return <KeyStepFruit key={`ks${i}`} x={t.x} y={t.y + 4} r={4.5} delay={i * 0.4} status={ks.status} />;
      })}
    </svg>
  );
}

function YoungTree({ decayStatus = 'active', keySteps = [] }: { decayStatus?: string; keySteps?: KeyStepFruitData[] }) {
  const cx = 280, baseY = 378;
  const branches = React.useMemo(() => buildTree(cx, baseY, 4, decayStatus), [decayStatus]);
  const tips = getTips(branches, 3);
  return (
    <svg viewBox="0 0 560 430" style={{ width: "100%", height: "100%" }}>
      <Defs /><Sky w={560} h={430} skyId={decayStatus !== 'active' ? 'dWiltingSky' : 'dSky'} /><Ground w={560} h={430} cx={cx} />
      <SurfaceRoots cx={cx} y={baseY} />
      <Branches branches={branches} />
      {tips.map((t, i) => <LeafCluster key={i} x={t.x} y={t.y} sz={17 + rng(i * 5) * 9} decayStatus={decayStatus} />)}
      {keySteps.slice(0, 4).map((ks, i) => {
        const t = tips[i % Math.max(1, tips.length)] || { x: cx, y: baseY - 60 };
        return <KeyStepFruit key={`ks${i}`} x={t.x} y={t.y + 4} r={5} delay={i * 0.4} status={ks.status} />;
      })}
    </svg>
  );
}

function FloweringTree({ decayStatus = 'active', keySteps = [] }: { decayStatus?: string; keySteps?: KeyStepFruitData[] }) {
  const cx = 280, baseY = 378;
  const branches = React.useMemo(() => buildTree(cx, baseY, 6, decayStatus), [decayStatus]);

  const tips6 = getTips(branches, 6);
  const tips5 = getTips(branches, 5);
  const tips4 = getTips(branches, 4);

  const flowerTips = [
    ...tips6.filter((_, i) => i % 3 === 0),
    ...tips5.filter((_, i) => i % 4 === 1),
  ];

  const leafTips = [
    ...tips6.filter((_, i) => i % 3 !== 0),
    ...tips5.filter((_, i) => i % 4 !== 1),
    ...tips4,
  ];

  const groundFlowers = Array.from({ length: 8 }, (_, i) => ({
    x: 90 + rng(i * 73 + 5) * 380,
    y: 390 + rng(i * 73 + 6) * 22,
    sz: 3 + rng(i * 73 + 7) * 2,
    shade: i % 3,
    delay: rng(i * 73 + 8) * 2.5,
    rot: rng(i * 73 + 9) * 72,
  }));

  // Combined placement candidates for key-step fruits
  const ksSlots = [...tips4, ...tips5];

  return (
    <svg viewBox="0 0 560 430" style={{ width: "100%", height: "100%" }}>
      <Defs />
      <Sky w={560} h={430} bloom={decayStatus === 'active'} skyId={decayStatus !== 'active' ? 'dWiltingSky' : 'dSky'} />

      <ellipse cx={cx} cy={baseY - 140} rx={200} ry={160} fill="url(#dPinkGlow)" opacity={decayStatus === 'active' ? 0.5 : 0.15} />

      <Ground w={560} h={430} cx={cx} />
      <SurfaceRoots cx={cx} y={baseY} />

      <Branches branches={branches} />

      {leafTips.map((t, i) => (
        <LeafCluster key={`lf${i}`} x={t.x} y={t.y} sz={14 + rng(i * 5) * 8} decayStatus={decayStatus} />
      ))}

      {branches.filter(b => b.lv === 4 || b.lv === 5).map((b, i) => (
        <LeafSprig key={`ls${i}`}
          x={(b.x1 * 0.35 + b.x2 * 0.65) + (rng(i * 11 + 1) - 0.5) * 4}
          y={(b.y1 * 0.35 + b.y2 * 0.65) + (rng(i * 11 + 2) - 0.5) * 4}
          sz={8 + rng(i * 11 + 3) * 5}
          rot={-180 + rng(i * 11 + 4) * 360}
          decayStatus={decayStatus}
        />
      ))}

      {flowerTips.map((t, i) => (
        <CherryFlower
          key={`fl${i}`}
          x={t.x}
          y={t.y}
          sz={5 + rng(i * 13 + 1) * 2.5}
          shade={i % 3}
          delay={rng(i * 13 + 2) * 3.0}
          rot={rng(i * 13 + 3) * 72}
          decayStatus={decayStatus}
        />
      ))}

      {groundFlowers.map((f, i) => (
        <CherryFlower key={`gf${i}`}
          x={f.x} y={f.y} sz={f.sz}
          shade={f.shade} delay={f.delay} rot={f.rot}
          decayStatus={decayStatus}
        />
      ))}

      {/* NEW: Key-step fruits overlay */}
      {keySteps.slice(0, Math.max(6, ksSlots.length)).map((ks, i) => {
        const slot = ksSlots[i % Math.max(1, ksSlots.length)] || { x: cx, y: baseY - 80 };
        return <KeyStepFruit key={`ks${i}`} x={slot.x + (rng(i * 7) - 0.5) * 6} y={slot.y + 6} r={5.5} delay={i * 0.35} status={ks.status} />;
      })}
    </svg>
  );
}

function FruitingTree({ decayStatus = 'active', keySteps = [] }: { decayStatus?: string; keySteps?: KeyStepFruitData[] }) {
  const cx = 280, baseY = 378;
  const branches = React.useMemo(() => buildTree(cx, baseY, 6, decayStatus), [decayStatus]);

  const tips6 = getTips(branches, 6);
  const tips5 = getTips(branches, 5);
  const tips4 = getTips(branches, 4);

  const fruitTips = [
    ...tips6.filter((_, i) => i % 3 === 0),
    ...tips5.filter((_, i) => i % 4 === 2),
  ];

  const leafTips = [
    ...tips6.filter((_, i) => i % 3 !== 0),
    ...tips5.filter((_, i) => i % 4 !== 2),
    ...tips4,
  ];

  const groundApples = Array.from({ length: 6 }, (_, i) => ({
    x: 110 + rng(i * 83 + 5) * 340,
    y: 392 + rng(i * 83 + 6) * 18,
    r: 4 + rng(i * 83 + 7) * 3,
    delay: rng(i * 83 + 8) * 2,
  }));

  // Combined placement candidates for key-step fruits
  const ksSlots = [...tips5, ...tips4, ...tips6];

  return (
    <svg viewBox="0 0 560 430" style={{ width: "100%", height: "100%" }}>
      <Defs /><Sky w={560} h={430} bloom={false} skyId={decayStatus !== 'active' ? 'dWiltingSky' : 'dSky'} /><Ground w={560} h={430} cx={cx} />
      <SurfaceRoots cx={cx} y={baseY} />
      <Branches branches={branches} />

      {leafTips.map((t, i) => (
        <LeafCluster key={`lf${i}`} x={t.x} y={t.y} sz={14 + rng(i * 5) * 8} decayStatus={decayStatus} />
      ))}

      {branches.filter(b => b.lv === 4 || b.lv === 5).map((b, i) => (
        <LeafSprig key={`ls${i}`}
          x={(b.x1 * 0.35 + b.x2 * 0.65) + (rng(i * 11 + 1) - 0.5) * 4}
          y={(b.y1 * 0.35 + b.y2 * 0.65) + (rng(i * 11 + 2) - 0.5) * 4}
          sz={8 + rng(i * 11 + 3) * 5}
          rot={-180 + rng(i * 11 + 4) * 360}
          decayStatus={decayStatus}
        />
      ))}

      {fruitTips.map((t, i) => (
        <Fruit key={`fr${i}`} x={t.x} y={t.y + 4} r={5 + rng(i * 13 + 1) * 2.5} delay={rng(i * 13 + 2) * 3.0} v={i} decayStatus={decayStatus} />
      ))}

      {groundApples.map((a, i) => (
        <g key={`ga${i}`}>
          <circle cx={a.x} cy={a.y} r={a.r} fill={decayStatus === 'dying' ? 'url(#dLeafDying)' : decayStatus === 'wilting' ? 'url(#dLeafWilting)' : "url(#fRed)"} />
          <ellipse cx={a.x - a.r * 0.25} cy={a.y - a.r * 0.22} rx={a.r * 0.28} ry={a.r * 0.20} fill="white" opacity="0.38" transform={`rotate(-25,${a.x - a.r * 0.25},${a.y - a.r * 0.22})`} />
          <path d={`M${a.x},${a.y - a.r} Q${a.x + a.r * 0.4},${a.y - a.r * 1.5} ${a.x + a.r * 0.2},${a.y - a.r * 1.7}`} stroke="#3a2006" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        </g>
      ))}

      {/* NEW: Key-step fruits overlay */}
      {keySteps.slice(0, Math.max(6, ksSlots.length)).map((ks, i) => {
        const slot = ksSlots[i % Math.max(1, ksSlots.length)] || { x: cx, y: baseY - 100 };
        return <KeyStepFruit key={`ks${i}`} x={slot.x + (rng(i * 7) - 0.5) * 6} y={slot.y + 8} r={5.5} delay={i * 0.35} status={ks.status} />;
      })}
    </svg>
  );
}

/* ══ ACHIEVEMENTS ══ */
const ACHIEVEMENTS = [
  { icon: "⭐", title: "First Task Completed", sub: "Earned Today", color: "#f59e0b" },
  { icon: "🔥", title: "3-Day Streak", sub: "Unlocked 2 Days Ago", color: "#ef4444" },
  { icon: "🕐", title: "Early Bird", sub: "Unlocked 5 Days Ago", color: "#6366f1" },
  { icon: "🏆", title: "Perfect Week", sub: "Unlocked 1 Week Ago", color: "#f59e0b" },
];

export default function AchievementTree({
  projectId,
  keySteps = [],
}: {
  projectId?: string;
  keySteps?: KeyStepFruitData[];
}) {
  const [points, setPoints] = React.useState(0);
  const [stage, setStage] = React.useState(STAGES[0]);
  const [decayStatus, setDecayStatus] = React.useState<'active'|'wilting'|'dying'>('active');
  const [confetti, setConfetti] = React.useState(false);
  const [animKey, setAnimKey] = React.useState(0);

  // initialize from per-project points if projectId provided, otherwise global points
  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!projectId) {
        setPoints(getPoints());
        setDecayStatus('active');
        return;
      }
      const pts = await fetchProjectPoints(projectId);
      if (!mounted) return;
      setPoints(pts);
      const ds = await fetchProjectDecayStatus(projectId);
      if (!mounted) return;
      setDecayStatus(ds as any);
    }
    load();
    return () => { mounted = false; };
  }, [projectId]);

  // respond to localStorage changes (other tabs or app writes when tasks complete)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (!e) return;
      // Just refresh the points snapshot whenever storage changes
      if (!projectId) {
        setPoints(getPoints());
      } else {
        fetchProjectPoints(projectId).then(p => setPoints(p)).catch(() => {});
        fetchProjectDecayStatus(projectId).then(s => setDecayStatus(s as any)).catch(() => {});
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [projectId]);

  // Real-time synchronization via WebSocket
  useWebSocket({
    'project_progress_updated': (data) => {
      console.log('🌳 Real-time progress update:', data);
      if (data.projectId === projectId) {
        setPoints(data.points);
        // Also update decay status if it was wilting/dying (activity resets decay)
        setDecayStatus('active');
      }
    }
  });

  // recompute stage when points change
  useEffect(() => {
    const s = computeStage(points);
    if (s.key !== stage.key) {
      setStage(s);
      setAnimKey(k => k + 1);
      if (s.key === "flowering" || s.key === "fruiting") {
        setConfetti(true);
        setTimeout(() => setConfetti(false), 3500);
      }
    }
  }, [points]);

  const idx = STAGES.findIndex(s => s.key === stage.key);
  const progress = idx < STAGES.length - 1
    ? Math.round(((points - stage.threshold) / (STAGES[idx + 1].threshold - stage.threshold)) * 100)
    : 100;
  const isBlooming = stage.key === "flowering" || stage.key === "fruiting";

  function renderTree() {
    switch (stage.key) {
      case "seed": return <SeedTree keySteps={keySteps} />;
      case "sprout": return <SproutTree keySteps={keySteps} />;
      case "sapling": return <SaplingTree decayStatus={decayStatus} keySteps={keySteps} />;
      case "tree": return <YoungTree decayStatus={decayStatus} keySteps={keySteps} />;
      case "flowering": return <FloweringTree decayStatus={decayStatus} keySteps={keySteps} />;
      case "fruiting": return <FruitingTree decayStatus={decayStatus} keySteps={keySteps} />;
      default: return null;
    }
  }

  return (
    <div style={{
      width: "100%",
      height: "100%",
      position: "relative",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }}>
      <style>{`
        @keyframes cfFall{ 0%  {transform:translateY(0) rotate(0deg);opacity:1;} 100%{transform:translateY(110vh) translateX(var(--drift,40px)) rotate(540deg);opacity:0;} }
        @keyframes ptFall{ 0%  {transform:translateY(-5%) translateX(0) rotate(-25deg);opacity:0.9;} 50% {transform:translateY(48vh) translateX(calc(var(--drift,30px)*.55)) rotate(18deg);opacity:0.7;} 100%{transform:translateY(108vh) translateX(var(--drift,30px)) rotate(80deg);opacity:0;} }
        @keyframes growIn{ 0%  {transform:scale(0.68) translateY(28px);opacity:0;} 100%{transform:scale(1) translateY(0);opacity:1;} }
        @keyframes flSway{ from{transform:translate(0px,0px) rotate(-1.5deg);} to  {transform:translate(0px,-4px) rotate(1.5deg);} }
        @keyframes frBob{ from{transform:translateY(0px);} to  {transform:translateY(-4px);} }
        @keyframes stPulse{ 0%,100%{box-shadow:0 0 0 0 rgba(80,200,40,0);} 50%    {box-shadow:0 0 18px 5px rgba(80,200,40,0.40);} }
      `}</style>

      <div style={{ width: "100%", height: "100%", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Confetti active={confetti} />
        <FallingPetals active={isBlooming} />
        <div key={animKey} style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {renderTree()}
        </div>
      </div>
    </div>
  );
}
