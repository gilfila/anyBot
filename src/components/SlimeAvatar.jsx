import { useMemo } from "react";
import { presets, avatarColors, avatarShapes, avatarFaces } from "../constants.js";

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function generateBlobPath(seed, size = 100, shapeId = "blob") {
  const points = 8;
  const angleStep = (Math.PI * 2) / points;
  const center = size / 2;
  
  let baseRadius = size * 0.38;
  let variance = size * 0.08;
  let scaleX = 1;
  let scaleY = 1;
  
  switch (shapeId) {
    case "round":
      variance = size * 0.03;
      break;
    case "tall":
      scaleY = 1.15;
      scaleX = 0.9;
      variance = size * 0.06;
      break;
    case "wide":
      scaleX = 1.15;
      scaleY = 0.9;
      variance = size * 0.06;
      break;
    case "spiky":
      variance = size * 0.14;
      break;
    case "wavy":
      variance = size * 0.10;
      break;
    default:
      break;
  }

  const coords = [];
  for (let i = 0; i < points; i++) {
    const angle = i * angleStep - Math.PI / 2;
    let radiusOffset = ((seed >> (i * 3)) & 7) / 7 - 0.5;
    
    if (shapeId === "wavy") {
      radiusOffset = Math.sin(i * 1.5 + seed * 0.1) * 0.5;
    }
    
    const radius = baseRadius + radiusOffset * variance;
    const x = center + Math.cos(angle) * radius * scaleX;
    const y = center + Math.sin(angle) * radius * scaleY;
    coords.push({ x, y });
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

function getFaceElements(faceId, seed) {
  const baseEyeY = 50;
  const baseEyeRadius = 4;
  const baseMouthY = 58;
  
  switch (faceId) {
    case "happy":
      return {
        leftEye: { cx: 40, cy: baseEyeY - 2, rx: baseEyeRadius, ry: baseEyeRadius },
        rightEye: { cx: 60, cy: baseEyeY - 2, rx: baseEyeRadius, ry: baseEyeRadius },
        mouth: "M 43 56 Q 50 65 57 56",
        mouthStrokeWidth: 2,
      };
    case "focused":
      return {
        leftEye: { cx: 40, cy: baseEyeY, rx: 3.5, ry: 4 },
        rightEye: { cx: 60, cy: baseEyeY, rx: 3.5, ry: 4 },
        mouth: "M 47 58 L 53 58",
        mouthStrokeWidth: 1.5,
      };
    case "curious":
      return {
        leftEye: { cx: 42, cy: baseEyeY - 1, rx: 4.5, ry: 5 },
        rightEye: { cx: 62, cy: baseEyeY + 1, rx: 3.5, ry: 3.5 },
        mouth: "M 46 59 Q 50 61 54 58",
        mouthStrokeWidth: 1.5,
      };
    case "sleepy":
      return {
        leftEye: { cx: 40, cy: baseEyeY, rx: 5, ry: 2 },
        rightEye: { cx: 60, cy: baseEyeY, rx: 5, ry: 2 },
        mouth: "M 47 59 Q 50 60 53 59",
        mouthStrokeWidth: 1.5,
      };
    case "excited":
      return {
        leftEye: { cx: 39, cy: baseEyeY - 3, rx: 5, ry: 5.5 },
        rightEye: { cx: 61, cy: baseEyeY - 3, rx: 5, ry: 5.5 },
        mouth: "M 42 56 Q 50 68 58 56",
        mouthStrokeWidth: 2,
      };
    default:
      return {
        leftEye: { cx: 40, cy: baseEyeY, rx: baseEyeRadius, ry: baseEyeRadius },
        rightEye: { cx: 60, cy: baseEyeY, rx: baseEyeRadius, ry: baseEyeRadius },
        mouth: "M 45 58 Q 50 62 55 58",
        mouthStrokeWidth: 1.5,
      };
  }
}

function getDefaultAvatarFromName(name, harness) {
  const seed = hashString(name || "bot");
  const harnessColor = presets.find((p) => p.harness === harness)?.color;
  const colorIndex = harnessColor 
    ? avatarColors.findIndex(c => c.id === harnessColor)
    : seed % avatarColors.length;
  
  return {
    color: avatarColors[colorIndex >= 0 ? colorIndex : 0].id,
    shape: avatarShapes[seed % avatarShapes.length].id,
    face: avatarFaces[seed % avatarFaces.length].id,
  };
}

export function parseAvatarConfig(avatarString, name, harness) {
  const defaults = getDefaultAvatarFromName(name, harness);
  
  if (!avatarString) {
    return defaults;
  }
  
  try {
    const parsed = JSON.parse(avatarString);
    return {
      color: parsed.color || defaults.color,
      shape: parsed.shape || defaults.shape,
      face: parsed.face || defaults.face,
    };
  } catch {
    return defaults;
  }
}

export function stringifyAvatarConfig(config) {
  return JSON.stringify(config);
}

function getAnimationDelays(seed) {
  const breatheDelay = ((seed % 100) / 100) * 3;
  const wobbleDelay = (((seed >> 3) % 100) / 100) * 4;
  const blinkDelay = (((seed >> 6) % 100) / 100) * 4;
  const bounceDelay = ((seed % 60) / 100);
  const jiggleDelay = (((seed >> 2) % 40) / 100);
  const lookDelay = (((seed >> 4) % 100) / 100);
  
  return {
    '--slime-breathe-delay': `${breatheDelay.toFixed(2)}s`,
    '--slime-wobble-delay': `${wobbleDelay.toFixed(2)}s`,
    '--slime-blink-delay': `${blinkDelay.toFixed(2)}s`,
    '--slime-bounce-delay': `${bounceDelay.toFixed(2)}s`,
    '--slime-jiggle-delay': `${jiggleDelay.toFixed(2)}s`,
    '--slime-look-delay': `${lookDelay.toFixed(2)}s`,
  };
}

function mixColor(color1, color2, ratio) {
  const hex1 = color1.replace('#', '');
  const hex2 = color2.replace('#', '');
  const r1 = parseInt(hex1.substring(0, 2), 16);
  const g1 = parseInt(hex1.substring(2, 4), 16);
  const b1 = parseInt(hex1.substring(4, 6), 16);
  const r2 = parseInt(hex2.substring(0, 2), 16);
  const g2 = parseInt(hex2.substring(2, 4), 16);
  const b2 = parseInt(hex2.substring(4, 6), 16);
  const r = Math.round(r1 + (r2 - r1) * ratio);
  const g = Math.round(g1 + (g2 - g1) * ratio);
  const b = Math.round(b1 + (b2 - b1) * ratio);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function lightenColor(color, amount) {
  return mixColor(color, '#ffffff', amount);
}

function darkenColor(color, amount) {
  return mixColor(color, '#000000', amount);
}

export function SlimeAvatar({ employee, small = false, working = false, avatarConfig = null }) {
  const config = useMemo(() => {
    if (avatarConfig) {
      return avatarConfig;
    }
    return parseAvatarConfig(
      employee?.avatar,
      employee?.name || employee?.id || "bot",
      employee?.harness
    );
  }, [employee?.avatar, employee?.name, employee?.id, employee?.harness, avatarConfig]);
  
  const colorDef = useMemo(() => 
    avatarColors.find(c => c.id === config.color) || avatarColors[0],
    [config.color]
  );
  
  const size = small ? 33 : 43;
  const seed = useMemo(
    () => hashString(employee?.name || employee?.id || "bot"),
    [employee?.name, employee?.id]
  );
  
  const blobPath = useMemo(
    () => generateBlobPath(seed, 100, config.shape),
    [seed, config.shape]
  );
  
  const faceElements = useMemo(
    () => getFaceElements(config.face, seed),
    [config.face, seed]
  );

  const animationClass = working ? "slime-working" : "slime-idle";
  const animationDelays = useMemo(() => getAnimationDelays(seed), [seed]);
  
  const highlightColor = useMemo(() => lightenColor(colorDef.fill, 0.6), [colorDef.fill]);
  const midColor = useMemo(() => mixColor(colorDef.fill, colorDef.stroke, 0.5), [colorDef.fill, colorDef.stroke]);
  const shadowColor = useMemo(() => darkenColor(colorDef.stroke, 0.15), [colorDef.stroke]);
  const rimColor = useMemo(() => lightenColor(colorDef.fill, 0.35), [colorDef.fill]);

  return (
    <span
      className={`slime-avatar ${small ? "small" : ""} ${animationClass}`}
      style={{ width: size, height: size, ...animationDelays }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <radialGradient id={`grad-${seed}`} cx="35%" cy="30%" r="70%" fx="30%" fy="25%">
            <stop offset="0%" stopColor={highlightColor} />
            <stop offset="30%" stopColor={colorDef.fill} />
            <stop offset="70%" stopColor={midColor} />
            <stop offset="100%" stopColor={shadowColor} />
          </radialGradient>
          <radialGradient id={`inner-shadow-${seed}`} cx="50%" cy="85%" r="60%">
            <stop offset="0%" stopColor={shadowColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={shadowColor} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`rim-${seed}`} cx="70%" cy="75%" r="45%">
            <stop offset="60%" stopColor={rimColor} stopOpacity="0" />
            <stop offset="100%" stopColor={rimColor} stopOpacity="0.4" />
          </radialGradient>
          <filter id={`glow-${seed}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
            <feOffset in="blur" dx="0" dy="2" result="offsetBlur" />
            <feFlood floodColor={colorDef.stroke} floodOpacity="0.2" result="color" />
            <feComposite in="color" in2="offsetBlur" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="slime-body" filter={`url(#glow-${seed})`}>
          <path
            d={blobPath}
            fill={`url(#grad-${seed})`}
            stroke={colorDef.stroke}
            strokeWidth="1.5"
            className="slime-outer"
          />
          <path
            d={blobPath}
            fill={`url(#inner-shadow-${seed})`}
            stroke="none"
          />
          <path
            d={blobPath}
            fill={`url(#rim-${seed})`}
            stroke="none"
          />
          <ellipse
            cx="36"
            cy="38"
            rx={small ? 7 : 8}
            ry={small ? 4 : 5}
            fill="#fff"
            opacity="0.55"
            className="slime-highlight"
          />
          <ellipse
            cx="40"
            cy="42"
            rx={small ? 3 : 4}
            ry={small ? 2 : 2.5}
            fill="#fff"
            opacity="0.35"
          />
          <ellipse
            cx={faceElements.leftEye.cx}
            cy={faceElements.leftEye.cy}
            rx={faceElements.leftEye.rx}
            ry={faceElements.leftEye.ry}
            fill="#333"
            opacity="0.65"
            className="slime-eye left"
          />
          <ellipse
            cx={faceElements.rightEye.cx}
            cy={faceElements.rightEye.cy}
            rx={faceElements.rightEye.rx}
            ry={faceElements.rightEye.ry}
            fill="#333"
            opacity="0.65"
            className="slime-eye right"
          />
          <ellipse
            cx={faceElements.leftEye.cx + 1.2}
            cy={faceElements.leftEye.cy - 1.2}
            rx="1.8"
            ry="1.2"
            fill="#fff"
            opacity="0.9"
            className="slime-eye-shine left"
          />
          <ellipse
            cx={faceElements.rightEye.cx + 1.2}
            cy={faceElements.rightEye.cy - 1.2}
            rx="1.8"
            ry="1.2"
            fill="#fff"
            opacity="0.9"
            className="slime-eye-shine right"
          />
          <path
            d={faceElements.mouth}
            fill="none"
            stroke="#333"
            strokeWidth={faceElements.mouthStrokeWidth}
            strokeLinecap="round"
            opacity="0.5"
            className="slime-mouth"
          />
        </g>
      </svg>
    </span>
  );
}

export function SlimeAvatarPreview({ color, shape, face, size = 80 }) {
  const config = { color, shape, face };
  const colorDef = avatarColors.find(c => c.id === color) || avatarColors[0];
  const seed = 42;
  const blobPath = generateBlobPath(seed, 100, shape);
  const faceElements = getFaceElements(face, seed);
  
  const highlightColor = lightenColor(colorDef.fill, 0.6);
  const midColor = mixColor(colorDef.fill, colorDef.stroke, 0.5);
  const shadowColor = darkenColor(colorDef.stroke, 0.15);
  const rimColor = lightenColor(colorDef.fill, 0.35);

  return (
    <span
      className="slime-avatar-preview slime-idle"
      style={{ 
        width: size, 
        height: size, 
        display: 'inline-flex',
        filter: 'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.1)) drop-shadow(0 6px 12px rgba(0, 0, 0, 0.08))'
      }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <radialGradient id="preview-grad" cx="35%" cy="30%" r="70%" fx="30%" fy="25%">
            <stop offset="0%" stopColor={highlightColor} />
            <stop offset="30%" stopColor={colorDef.fill} />
            <stop offset="70%" stopColor={midColor} />
            <stop offset="100%" stopColor={shadowColor} />
          </radialGradient>
          <radialGradient id="preview-inner-shadow" cx="50%" cy="85%" r="60%">
            <stop offset="0%" stopColor={shadowColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={shadowColor} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="preview-rim" cx="70%" cy="75%" r="45%">
            <stop offset="60%" stopColor={rimColor} stopOpacity="0" />
            <stop offset="100%" stopColor={rimColor} stopOpacity="0.4" />
          </radialGradient>
          <filter id="preview-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
            <feOffset in="blur" dx="0" dy="2" result="offsetBlur" />
            <feFlood floodColor={colorDef.stroke} floodOpacity="0.2" result="color" />
            <feComposite in="color" in2="offsetBlur" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="slime-body" filter="url(#preview-glow)">
          <path
            d={blobPath}
            fill="url(#preview-grad)"
            stroke={colorDef.stroke}
            strokeWidth="1.5"
            className="slime-outer"
          />
          <path
            d={blobPath}
            fill="url(#preview-inner-shadow)"
            stroke="none"
          />
          <path
            d={blobPath}
            fill="url(#preview-rim)"
            stroke="none"
          />
          <ellipse
            cx="36"
            cy="38"
            rx="8"
            ry="5"
            fill="#fff"
            opacity="0.55"
            className="slime-highlight"
          />
          <ellipse
            cx="40"
            cy="42"
            rx="4"
            ry="2.5"
            fill="#fff"
            opacity="0.35"
          />
          <ellipse
            cx={faceElements.leftEye.cx}
            cy={faceElements.leftEye.cy}
            rx={faceElements.leftEye.rx}
            ry={faceElements.leftEye.ry}
            fill="#333"
            opacity="0.65"
            className="slime-eye left"
          />
          <ellipse
            cx={faceElements.rightEye.cx}
            cy={faceElements.rightEye.cy}
            rx={faceElements.rightEye.rx}
            ry={faceElements.rightEye.ry}
            fill="#333"
            opacity="0.65"
            className="slime-eye right"
          />
          <ellipse
            cx={faceElements.leftEye.cx + 1.2}
            cy={faceElements.leftEye.cy - 1.2}
            rx="1.8"
            ry="1.2"
            fill="#fff"
            opacity="0.9"
          />
          <ellipse
            cx={faceElements.rightEye.cx + 1.2}
            cy={faceElements.rightEye.cy - 1.2}
            rx="1.8"
            ry="1.2"
            fill="#fff"
            opacity="0.9"
          />
          <path
            d={faceElements.mouth}
            fill="none"
            stroke="#333"
            strokeWidth={faceElements.mouthStrokeWidth}
            strokeLinecap="round"
            opacity="0.5"
          />
        </g>
      </svg>
    </span>
  );
}
