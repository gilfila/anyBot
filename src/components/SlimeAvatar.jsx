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

  return (
    <span
      className={`slime-avatar ${small ? "small" : ""} ${animationClass}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <linearGradient id={`grad-${seed}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colorDef.fill} />
            <stop offset="100%" stopColor={colorDef.stroke} />
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
            stroke={colorDef.stroke}
            strokeWidth="1.5"
            className="slime-outer"
          />
          <ellipse
            cx="38"
            cy="40"
            rx="6"
            ry="4"
            fill={colorDef.accent}
            opacity="0.3"
            className="slime-highlight"
          />
          <ellipse
            cx={faceElements.leftEye.cx}
            cy={faceElements.leftEye.cy}
            rx={faceElements.leftEye.rx}
            ry={faceElements.leftEye.ry}
            fill="#333"
            opacity="0.6"
            className="slime-eye left"
          />
          <ellipse
            cx={faceElements.rightEye.cx}
            cy={faceElements.rightEye.cy}
            rx={faceElements.rightEye.rx}
            ry={faceElements.rightEye.ry}
            fill="#333"
            opacity="0.6"
            className="slime-eye right"
          />
          <ellipse
            cx={faceElements.leftEye.cx + 1}
            cy={faceElements.leftEye.cy - 1}
            rx="1.5"
            ry="1"
            fill="#fff"
            opacity="0.8"
            className="slime-eye-shine left"
          />
          <ellipse
            cx={faceElements.rightEye.cx + 1}
            cy={faceElements.rightEye.cy - 1}
            rx="1.5"
            ry="1"
            fill="#fff"
            opacity="0.8"
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

  return (
    <span
      className="slime-avatar-preview slime-idle"
      style={{ width: size, height: size, display: 'inline-flex' }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <linearGradient id="preview-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colorDef.fill} />
            <stop offset="100%" stopColor={colorDef.stroke} />
          </linearGradient>
        </defs>
        <g className="slime-body">
          <path
            d={blobPath}
            fill="url(#preview-grad)"
            stroke={colorDef.stroke}
            strokeWidth="1.5"
            className="slime-outer"
          />
          <ellipse
            cx="38"
            cy="40"
            rx="6"
            ry="4"
            fill={colorDef.accent}
            opacity="0.3"
            className="slime-highlight"
          />
          <ellipse
            cx={faceElements.leftEye.cx}
            cy={faceElements.leftEye.cy}
            rx={faceElements.leftEye.rx}
            ry={faceElements.leftEye.ry}
            fill="#333"
            opacity="0.6"
            className="slime-eye left"
          />
          <ellipse
            cx={faceElements.rightEye.cx}
            cy={faceElements.rightEye.cy}
            rx={faceElements.rightEye.rx}
            ry={faceElements.rightEye.ry}
            fill="#333"
            opacity="0.6"
            className="slime-eye right"
          />
          <ellipse
            cx={faceElements.leftEye.cx + 1}
            cy={faceElements.leftEye.cy - 1}
            rx="1.5"
            ry="1"
            fill="#fff"
            opacity="0.8"
          />
          <ellipse
            cx={faceElements.rightEye.cx + 1}
            cy={faceElements.rightEye.cy - 1}
            rx="1.5"
            ry="1"
            fill="#fff"
            opacity="0.8"
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
