import React, { useEffect, useRef } from "react";
import { prefersStill, useThemeState } from "../../lib/theme.js";
import "../../themes/themes.css";

// Full-window decoration behind the app for themes that have one. It never
// takes pointer events, pauses while the window is hidden, and freezes when
// the owner or the OS asks for less motion.
export function ThemeBackdrop() {
  const { theme, motion } = useThemeState();
  const still = prefersStill(motion);
  const kind = theme.decor.backdrop;
  if (!kind || kind === "none") return null;
  return (
    <div className={`theme-backdrop backdrop-${kind}${still ? " is-still" : ""}`} aria-hidden="true">
      {kind === "rain" && <MatrixRain still={still} />}
      {kind === "meadow" && <Meadow />}
      {kind === "grid" && <NeonCity />}
    </div>
  );
}

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789{}[]()<>=+*/;:$#&|";
const pick = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

function MatrixRain({ still }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas.getContext("2d");
    const css = getComputedStyle(document.documentElement);
    const trail = css.getPropertyValue("--ink-3").trim() || "oklch(0.7 0.12 145)";
    const head = css.getPropertyValue("--ink").trim() || "oklch(0.9 0.17 145)";
    const paper = css.getPropertyValue("--paper").trim() || "oklch(0.14 0.02 150)";
    const fade = paper.replace(/\)$/, " / 0.09)");
    const size = 16;
    let columns = [];
    let frame = 0;
    let last = 0;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const rows = canvas.height / size;
      columns = Array.from({ length: Math.ceil(canvas.width / size) }, () => ({
        y: Math.random() * rows * -1,
        speed: 0.35 + Math.random() * 0.75,
      }));
      context.fillStyle = paper;
      context.fillRect(0, 0, canvas.width, canvas.height);
    };
    const step = () => {
      context.fillStyle = fade;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = `${size}px "Cascadia Mono", Consolas, monospace`;
      columns.forEach((column, index) => {
        const x = index * size;
        const y = column.y * size;
        if (y > 0) {
          context.fillStyle = trail;
          context.fillText(pick(), x, y - size);
          context.fillStyle = head;
          context.fillText(pick(), x, y);
        }
        column.y += column.speed;
        if (y > canvas.height && Math.random() > 0.975) column.y = 0;
      });
    };
    const loop = (time) => {
      frame = requestAnimationFrame(loop);
      // About 16 frames a second, and nothing while the window is hidden.
      if (document.hidden || time - last < 62) return;
      last = time;
      step();
    };
    resize();
    if (still) for (let i = 0; i < 90; i++) step();
    else frame = requestAnimationFrame(loop);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [still]);
  return <canvas ref={ref} className="matrix-rain" />;
}

// A solarpunk valley: sun, drifting clouds, terraced harvests, fruit trees,
// solar fields, a wind turbine, and robots tending the gardens.
function Meadow() {
  return (
    <>
      <div className="meadow-sun" />
      <svg className="meadow-cloud cloud-a" viewBox="0 0 220 80">
        <path d="M30 62 Q10 62 12 46 Q14 30 34 32 Q38 12 62 14 Q80 0 104 12 Q128 4 142 24 Q170 18 176 40 Q204 40 202 58 Q200 70 180 70 L40 70 Q30 70 30 62Z" />
      </svg>
      <svg className="meadow-cloud cloud-b" viewBox="0 0 220 80">
        <path d="M24 60 Q8 58 14 44 Q20 32 38 36 Q46 18 70 22 Q88 8 112 20 Q140 14 150 34 Q178 30 184 50 Q204 54 196 66 L36 68 Q24 68 24 60Z" />
      </svg>
      <svg className="meadow-cloud cloud-c" viewBox="0 0 220 80">
        <path d="M40 60 Q22 60 26 46 Q30 34 48 38 Q56 22 80 24 Q98 12 120 24 Q146 20 152 40 Q176 40 174 56 Q172 66 156 66 L50 66 Q40 66 40 60Z" />
      </svg>
      <svg className="meadow-scene" viewBox="0 0 1600 560" preserveAspectRatio="xMidYMax slice">
        <defs>
          <pattern id="wheat" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
            <rect width="16" height="16" fill="oklch(0.86 0.11 88)" />
            <rect width="16" height="6" fill="oklch(0.8 0.13 80)" />
          </pattern>
          <pattern id="rows" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
            <rect width="22" height="22" fill="oklch(0.66 0.13 145)" />
            <rect width="22" height="7" fill="oklch(0.6 0.14 142)" />
          </pattern>
        </defs>
        {/* far hills with a solar field and a turbine */}
        <path d="M0 330 Q220 250 460 300 T920 280 T1360 270 T1600 290 V560 H0Z" fill="oklch(0.87 0.07 135)" />
        <g fill="oklch(0.42 0.06 250)" stroke="oklch(0.95 0.02 230)" strokeWidth="1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M${1010 + i * 34} 292 l26 -10 l12 14 l-26 10Z`} />
          ))}
        </g>
        <g className="meadow-turbine" transform="translate(1250 180)">
          <path d="M-3 0 L-6 110 H6 L3 0Z" fill="oklch(0.97 0.01 90)" stroke="oklch(0.75 0.03 150)" />
          <g className="meadow-blades">
            <path d="M0 0 L-4 -56 L4 -56Z M0 0 L50 26 L46 32Z M0 0 L-46 32 L-50 26Z" fill="oklch(0.97 0.01 90)" stroke="oklch(0.75 0.03 150)" />
          </g>
          <circle r="5" fill="oklch(0.9 0.02 90)" stroke="oklch(0.7 0.03 150)" />
        </g>
        {/* terraced wheat on the middle hills */}
        <path d="M0 400 Q260 300 560 360 T1100 340 T1600 360 V560 H0Z" fill="oklch(0.78 0.11 140)" />
        <path d="M120 400 Q330 330 560 372 L520 430 Q330 410 140 450Z" fill="url(#wheat)" />
        <path d="M980 356 Q1180 318 1400 356 L1380 410 Q1180 380 1000 410Z" fill="url(#wheat)" />
        {/* fruit trees */}
        {[
          [640, 360, 34, 0],
          [700, 372, 26, 1],
          [860, 350, 38, 0],
          [1480, 350, 32, 1],
          [60, 380, 30, 1],
        ].map(([x, y, r, variant], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <rect x="-4" y="-6" width="8" height={r + 10} rx="3" fill="oklch(0.46 0.06 60)" />
            <circle cy={-r * 0.6} r={r} fill={variant ? "oklch(0.58 0.13 148)" : "oklch(0.63 0.14 140)"} />
            <circle cx={-r * 0.55} cy={-r * 0.3} r={r * 0.7} fill={variant ? "oklch(0.62 0.13 145)" : "oklch(0.58 0.13 150)"} />
            {[[-0.4, -0.9], [0.3, -0.5], [-0.1, -0.2], [0.5, -1], [-0.7, -0.5]].map(([fx, fy], j) => (
              <circle key={j} cx={fx * r} cy={fy * r} r="4" fill={j % 2 ? "oklch(0.7 0.18 45)" : "oklch(0.62 0.2 28)"} />
            ))}
          </g>
        ))}
        {/* front hill with crop rows, sunflowers, and the garden crew */}
        <path d="M0 470 Q300 400 700 440 T1600 430 V560 H0Z" fill="url(#rows)" />
        <path d="M0 500 Q400 450 800 490 T1600 480 V560 H0Z" fill="oklch(0.62 0.13 145)" />
        {[180, 230, 280, 1300, 1350].map((x, i) => (
          <g key={x} transform={`translate(${x} ${468 + (i % 2) * 8})`}>
            <path d={`M0 0 V40`} stroke="oklch(0.5 0.12 140)" strokeWidth="3" />
            <circle r="11" fill="oklch(0.86 0.16 95)" />
            <circle r="5" fill="oklch(0.42 0.07 55)" />
          </g>
        ))}
        <Robot x={380} y={452} tool="can" />
        <Robot x={1100} y={452} tool="basket" flip />
        <g className="meadow-drone" transform="translate(760 330)">
          <ellipse rx="14" ry="7" fill="oklch(0.95 0.01 90)" stroke="oklch(0.4 0.03 160)" strokeWidth="2" />
          <path d="M-18 -9 H-4 M4 -9 H18" stroke="oklch(0.4 0.03 160)" strokeWidth="2" />
          <circle cx="4" r="2.5" fill="oklch(0.78 0.12 200)" />
        </g>
        {/* birds */}
        <path d="M300 150 q8 -8 16 0 q8 -8 16 0 M360 120 q6 -6 12 0 q6 -6 12 0" fill="none" stroke="oklch(0.45 0.04 230)" strokeWidth="2" />
      </svg>
    </>
  );
}

function Robot({ x, y, tool, flip = false }) {
  const ink = "oklch(0.38 0.04 165)";
  return (
    <g className="meadow-robot" transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
      <rect x="-16" y="-44" width="32" height="30" rx="9" fill="oklch(0.96 0.01 90)" stroke={ink} strokeWidth="2.5" />
      <rect x="-19" y="-74" width="38" height="28" rx="11" fill="oklch(0.96 0.01 90)" stroke={ink} strokeWidth="2.5" />
      <rect x="-12" y="-67" width="24" height="13" rx="6" fill="oklch(0.32 0.04 200)" />
      <circle cx="-5" cy="-60.5" r="2.4" fill="oklch(0.84 0.12 200)" />
      <circle cx="5" cy="-60.5" r="2.4" fill="oklch(0.84 0.12 200)" />
      <path d="M0 -74 V-84" stroke={ink} strokeWidth="2.5" />
      <circle cy="-86" r="4" fill="oklch(0.7 0.17 45)" />
      <path d="M-8 -14 V-4 M8 -14 V-4" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <path d="M-16 -36 L-26 -22" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M16 -36 L28 -26" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
      {tool === "can" ? (
        <g transform="translate(34 -24)">
          <rect x="-8" y="-8" width="16" height="14" rx="3" fill="oklch(0.62 0.13 170)" stroke={ink} strokeWidth="2" />
          <path d="M8 -4 L20 -12" stroke={ink} strokeWidth="2.5" />
          <path d="M22 -10 q4 6 1 12 M26 -8 q4 6 1 12" className="meadow-water" stroke="oklch(0.75 0.1 220)" strokeWidth="2" fill="none" />
        </g>
      ) : (
        <g transform="translate(32 -22)">
          <path d="M-12 -2 H12 L8 12 H-8Z" fill="oklch(0.64 0.09 70)" stroke={ink} strokeWidth="2" />
          <circle cx="-5" cy="-5" r="5" fill="oklch(0.62 0.2 28)" />
          <circle cx="4" cy="-6" r="5" fill="oklch(0.7 0.18 45)" />
          <circle cx="0" cy="-10" r="4.5" fill="oklch(0.8 0.15 95)" />
        </g>
      )}
    </g>
  );
}

// Midnight city: neon glow, a skyline with lit windows, and a rolling grid.
function NeonCity() {
  const buildings = [
    [0, 150, 90],
    [70, 230, 70],
    [130, 180, 110],
    [230, 290, 60],
    [285, 200, 90],
    [370, 250, 70],
    [430, 160, 120],
    [540, 310, 64],
    [600, 220, 100],
    [690, 170, 80],
    [760, 270, 90],
    [840, 190, 70],
    [900, 330, 58],
    [950, 240, 110],
    [1050, 180, 80],
    [1120, 280, 70],
    [1180, 210, 120],
    [1290, 300, 60],
    [1340, 170, 100],
    [1430, 240, 90],
    [1510, 190, 90],
  ];
  return (
    <>
      <svg className="neon-skyline" viewBox="0 0 1600 340" preserveAspectRatio="xMidYMax slice">
        {buildings.map(([x, h, w], i) => (
          <g key={i}>
            <rect x={x} y={340 - h} width={w} height={h} fill="oklch(0.14 0.04 285)" stroke="oklch(0.36 0.12 300 / 0.8)" />
            {Array.from({ length: Math.floor(h / 26) * Math.floor(w / 22) }, (_, j) => {
              const cols = Math.floor(w / 22);
              const cx = x + 8 + (j % cols) * 22;
              const cy = 340 - h + 12 + Math.floor(j / cols) * 26;
              const lit = (i * 7 + j * 3) % 5 === 0;
              return lit ? <rect key={j} x={cx} y={cy} width="8" height="5" fill={(i + j) % 3 ? "oklch(0.86 0.15 200 / 0.8)" : "oklch(0.7 0.27 340 / 0.8)"} /> : null;
            })}
          </g>
        ))}
      </svg>
      <div className="neon-horizon" />
      <div className="neon-floor" />
    </>
  );
}
