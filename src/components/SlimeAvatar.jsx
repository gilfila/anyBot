import { useMemo } from "react";
import { presets } from "../constants.js";

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function generateBlobPath(seed, size = 100) {
  const points = 8;
  const angleStep = (Math.PI * 2) / points;
  const center = size / 2;
  const baseRadius = size * 0.38;
  const variance = size * 0.08;

  const coords = [];
  for (let i = 0; i < points; i++) {
    const angle = i * angleStep - Math.PI / 2;
    const radiusOffset = ((seed >> (i * 3)) & 7) / 7 - 0.5;
    const radius = baseRadius + radiusOffset * variance;
    coords.push({
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    });
  }

  let path = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < points; i++) {
    const curr = coords[i];
    const next = coords[(i + 1) % points];
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    path += ` Q ${curr.x} ${curr.y} ${midX} ${midY}`;
  }
  path += " Z";
  return path;
}

const colorMap = {
  peach: { fill: "#f8e5d9", stroke: "#e8c4aa", accent: "#d4a484" },
  blue: { fill: "#dfeafa", stroke: "#b5cff0", accent: "#89afd8" },
  purple: { fill: "#ede5f7", stroke: "#d4c4eb", accent: "#b8a1d8" },
  green: { fill: "#e4efe4", stroke: "#bfd9bf", accent: "#9bc49b" },
};

export function SlimeAvatar({ employee, small = false, working = false }) {
  const color = presets.find((p) => p.harness === employee?.harness)?.color || "blue";
  const colors = colorMap[color] || colorMap.blue;
  const size = small ? 33 : 43;
  const seed = useMemo(
    () => hashString(employee?.name || employee?.id || "bot"),
    [employee?.name, employee?.id]
  );
  const blobPath = useMemo(() => generateBlobPath(seed, 100), [seed]);
  const secondBlobPath = useMemo(() => generateBlobPath(seed + 1, 100), [seed]);

  const animationClass = working ? "slime-working" : "slime-idle";

  return (
    <span
      className={`slime-avatar ${small ? "small" : ""} ${animationClass}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <linearGradient id={`grad-${seed}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colors.fill} />
            <stop offset="100%" stopColor={colors.stroke} />
          </linearGradient>
          <filter id={`glow-${seed}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="slime-body">
          <path
            d={blobPath}
            fill={`url(#grad-${seed})`}
            stroke={colors.stroke}
            strokeWidth="1.5"
            className="slime-outer"
          />
          <ellipse
            cx="38"
            cy="40"
            rx="6"
            ry="4"
            fill={colors.accent}
            opacity="0.3"
            className="slime-highlight"
          />
          <circle cx="40" cy="50" r="4" fill="#333" opacity="0.6" className="slime-eye left" />
          <circle cx="60" cy="50" r="4" fill="#333" opacity="0.6" className="slime-eye right" />
          <ellipse
            cx="41"
            cy="49"
            rx="1.5"
            ry="1"
            fill="#fff"
            opacity="0.8"
            className="slime-eye-shine left"
          />
          <ellipse
            cx="61"
            cy="49"
            rx="1.5"
            ry="1"
            fill="#fff"
            opacity="0.8"
            className="slime-eye-shine right"
          />
          <path
            d="M 45 58 Q 50 62 55 58"
            fill="none"
            stroke="#333"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.5"
            className="slime-mouth"
          />
        </g>
      </svg>
    </span>
  );
}
