import { useMemo } from "react";
import { presets, avatarColors, avatarHeadStyles, avatarEyeStyles } from "../constants.js";

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getHeadPath(headStyle, size = 100) {
  const center = size / 2;
  
  switch (headStyle) {
    case "dome":
      return `M 25 58 
              Q 25 30 50 25 
              Q 75 30 75 58 
              L 75 65 
              Q 75 72 68 72 
              L 32 72 
              Q 25 72 25 65 Z`;
    case "square":
      return `M 28 30 
              Q 28 25 33 25 
              L 67 25 
              Q 72 25 72 30 
              L 72 65 
              Q 72 72 65 72 
              L 35 72 
              Q 28 72 28 65 Z`;
    case "hexagon":
      return `M 50 23 
              L 72 35 
              L 72 60 
              L 65 72 
              L 35 72 
              L 28 60 
              L 28 35 Z`;
    case "visor":
      return `M 26 40 
              Q 26 28 38 25 
              L 62 25 
              Q 74 28 74 40 
              L 74 58 
              Q 74 72 62 72 
              L 38 72 
              Q 26 72 26 58 Z`;
    case "bubble":
      return `M 50 22 
              Q 78 22 78 50 
              Q 78 72 58 72 
              L 42 72 
              Q 22 72 22 50 
              Q 22 22 50 22 Z`;
    case "angular":
      return `M 50 24 
              L 73 32 
              L 76 52 
              L 70 72 
              L 30 72 
              L 24 52 
              L 27 32 Z`;
    default:
      return `M 25 58 
              Q 25 30 50 25 
              Q 75 30 75 58 
              L 75 65 
              Q 75 72 68 72 
              L 32 72 
              Q 25 72 25 65 Z`;
  }
}

function getEyeElements(eyeStyle, seed) {
  const baseY = 48;
  
  switch (eyeStyle) {
    case "round":
      return {
        leftEye: { type: "circle", cx: 40, cy: baseY, r: 6 },
        rightEye: { type: "circle", cx: 60, cy: baseY, r: 6 },
        highlight: { rx: 2, ry: 2, offsetX: 2, offsetY: -2 },
      };
    case "oval":
      return {
        leftEye: { type: "ellipse", cx: 40, cy: baseY, rx: 5, ry: 7 },
        rightEye: { type: "ellipse", cx: 60, cy: baseY, rx: 5, ry: 7 },
        highlight: { rx: 1.5, ry: 2, offsetX: 1.5, offsetY: -2 },
      };
    case "visor":
      return {
        leftEye: { type: "rect", x: 32, y: baseY - 4, width: 36, height: 8, rx: 4 },
        rightEye: null,
        highlight: { rx: 2, ry: 2, offsetX: -12, offsetY: -1 },
      };
    case "led":
      return {
        leftEye: { type: "rect", x: 34, y: baseY - 3, width: 10, height: 6, rx: 1 },
        rightEye: { type: "rect", x: 56, y: baseY - 3, width: 10, height: 6, rx: 1 },
        highlight: { rx: 1.5, ry: 1, offsetX: 1, offsetY: -1 },
      };
    case "dots":
      return {
        leftEye: { type: "circle", cx: 40, cy: baseY, r: 4 },
        rightEye: { type: "circle", cx: 60, cy: baseY, r: 4 },
        highlight: { rx: 1.2, ry: 1.2, offsetX: 1, offsetY: -1 },
      };
    case "slits":
      return {
        leftEye: { type: "ellipse", cx: 40, cy: baseY, rx: 7, ry: 3 },
        rightEye: { type: "ellipse", cx: 60, cy: baseY, rx: 7, ry: 3 },
        highlight: { rx: 2, ry: 1, offsetX: 2, offsetY: -0.5 },
      };
    default:
      return {
        leftEye: { type: "circle", cx: 40, cy: baseY, r: 6 },
        rightEye: { type: "circle", cx: 60, cy: baseY, r: 6 },
        highlight: { rx: 2, ry: 2, offsetX: 2, offsetY: -2 },
      };
  }
}

function renderEye(eye, fill, className) {
  if (!eye) return null;
  
  switch (eye.type) {
    case "circle":
      return <circle cx={eye.cx} cy={eye.cy} r={eye.r} fill={fill} className={className} />;
    case "ellipse":
      return <ellipse cx={eye.cx} cy={eye.cy} rx={eye.rx} ry={eye.ry} fill={fill} className={className} />;
    case "rect":
      return <rect x={eye.x} y={eye.y} width={eye.width} height={eye.height} rx={eye.rx} fill={fill} className={className} />;
    default:
      return null;
  }
}

function getAntennaStyle(seed) {
  const styles = ["single", "double", "ears"];
  return styles[seed % styles.length];
}

function getDefaultAvatarFromName(name, harness) {
  const seed = hashString(name || "bot");
  const harnessColor = presets.find((p) => p.harness === harness)?.color;
  const colorIndex = harnessColor 
    ? avatarColors.findIndex(c => c.id === harnessColor)
    : seed % avatarColors.length;
  
  return {
    color: avatarColors[colorIndex >= 0 ? colorIndex : 0].id,
    shape: avatarHeadStyles[seed % avatarHeadStyles.length].id,
    face: avatarEyeStyles[seed % avatarEyeStyles.length].id,
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
  const bobDelay = ((seed % 100) / 100) * 3;
  const glowDelay = (((seed >> 3) % 100) / 100) * 4;
  const blinkDelay = (((seed >> 6) % 100) / 100) * 5;
  const bounceDelay = ((seed % 60) / 100);
  const antennaDelay = (((seed >> 2) % 40) / 100);
  const pulseDelay = (((seed >> 4) % 100) / 100);
  
  return {
    '--robot-bob-delay': `${bobDelay.toFixed(2)}s`,
    '--robot-glow-delay': `${glowDelay.toFixed(2)}s`,
    '--robot-blink-delay': `${blinkDelay.toFixed(2)}s`,
    '--robot-bounce-delay': `${bounceDelay.toFixed(2)}s`,
    '--robot-antenna-delay': `${antennaDelay.toFixed(2)}s`,
    '--robot-pulse-delay': `${pulseDelay.toFixed(2)}s`,
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

export function RobotAvatar({ employee, small = false, working = false, avatarConfig = null }) {
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
  
  const headPath = useMemo(
    () => getHeadPath(config.shape, 100),
    [config.shape]
  );
  
  const eyeElements = useMemo(
    () => getEyeElements(config.face, seed),
    [config.face, seed]
  );
  
  const antennaStyle = useMemo(
    () => getAntennaStyle(seed),
    [seed]
  );

  const animationClass = working ? "robot-working" : "robot-idle";
  const animationDelays = useMemo(() => getAnimationDelays(seed), [seed]);
  
  const highlightColor = useMemo(() => lightenColor(colorDef.fill, 0.45), [colorDef.fill]);
  const bodyColor = useMemo(() => darkenColor(colorDef.fill, 0.18), [colorDef.fill]);
  const shadowColor = useMemo(() => darkenColor(colorDef.stroke, 0.35), [colorDef.stroke]);
  const rimColor = useMemo(() => lightenColor(colorDef.fill, 0.35), [colorDef.fill]);
  const eyeGlow = useMemo(() => colorDef.accent || lightenColor(colorDef.fill, 0.15), [colorDef.fill, colorDef.accent]);
  const eyeBright = useMemo(() => lightenColor(eyeGlow, 0.45), [eyeGlow]);

  return (
    <span
      className={`robot-avatar ${small ? "small" : ""} ${animationClass}`}
      style={{ width: size, height: size, ...animationDelays }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <linearGradient id={`head-grad-${seed}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={highlightColor} />
            <stop offset="35%" stopColor={colorDef.fill} />
            <stop offset="100%" stopColor={bodyColor} />
          </linearGradient>
          <linearGradient id={`body-grad-${seed}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={colorDef.fill} />
            <stop offset="100%" stopColor={shadowColor} />
          </linearGradient>
          <radialGradient id={`eye-glow-${seed}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={eyeBright} />
            <stop offset="60%" stopColor={eyeGlow} />
            <stop offset="100%" stopColor={darkenColor(eyeGlow, 0.3)} />
          </radialGradient>
          <radialGradient id={`rim-light-${seed}`} cx="80%" cy="20%" r="60%">
            <stop offset="0%" stopColor={rimColor} stopOpacity="0.75" />
            <stop offset="100%" stopColor={rimColor} stopOpacity="0" />
          </radialGradient>
          <filter id={`shadow-${seed}`} x="-20%" y="-10%" width="140%" height="150%">
            <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#000" floodOpacity="0.25" />
          </filter>
          <filter id={`glow-filter-${seed}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
            <feColorMatrix in="blur" type="saturate" values="1.3" result="saturatedBlur" />
            <feMerge>
              <feMergeNode in="saturatedBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        
        <g className="robot-body" filter={`url(#shadow-${seed})`}>
          {/* Drop shadow ellipse under robot */}
          <ellipse 
            cx="50" 
            cy="88" 
            rx="18" 
            ry="4" 
            fill="#000" 
            opacity="0.2"
            className="robot-shadow"
          />
          
          {/* Body/torso */}
          <path
            d="M 38 72 L 38 82 Q 38 86 42 86 L 58 86 Q 62 86 62 82 L 62 72"
            fill={`url(#body-grad-${seed})`}
            stroke={colorDef.stroke}
            strokeWidth="2"
            className="robot-torso"
          />
          
          {/* Tiny arms */}
          <ellipse cx="32" cy="78" rx="4" ry="3" fill={bodyColor} stroke={colorDef.stroke} strokeWidth="1" className="robot-arm left" />
          <ellipse cx="68" cy="78" rx="4" ry="3" fill={bodyColor} stroke={colorDef.stroke} strokeWidth="1" className="robot-arm right" />
          
          {/* Head/helmet */}
          <path
            d={headPath}
            fill={`url(#head-grad-${seed})`}
            stroke={colorDef.stroke}
            strokeWidth="2"
            className="robot-head"
          />
          
          {/* Rim light overlay */}
          <path
            d={headPath}
            fill={`url(#rim-light-${seed})`}
            stroke="none"
          />
          
          {/* Antenna */}
          <g className="robot-antenna">
            {antennaStyle === "single" && (
              <>
                <line x1="50" y1="25" x2="50" y2="14" stroke={colorDef.stroke} strokeWidth="2" strokeLinecap="round" />
                <circle cx="50" cy="11" r="4" fill={eyeGlow} className="antenna-orb" filter={`url(#glow-filter-${seed})`} />
              </>
            )}
            {antennaStyle === "double" && (
              <>
                <line x1="40" y1="28" x2="35" y2="16" stroke={colorDef.stroke} strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="34" cy="13" r="3" fill={eyeGlow} className="antenna-orb" filter={`url(#glow-filter-${seed})`} />
                <line x1="60" y1="28" x2="65" y2="16" stroke={colorDef.stroke} strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="66" cy="13" r="3" fill={eyeGlow} className="antenna-orb" filter={`url(#glow-filter-${seed})`} />
              </>
            )}
            {antennaStyle === "ears" && (
              <>
                <rect x="22" y="35" width="6" height="12" rx="2" fill={bodyColor} stroke={colorDef.stroke} strokeWidth="1" />
                <rect x="72" y="35" width="6" height="12" rx="2" fill={bodyColor} stroke={colorDef.stroke} strokeWidth="1" />
              </>
            )}
          </g>
          
          {/* Face plate detail */}
          <ellipse 
            cx="50" 
            cy="52" 
            rx="20" 
            ry="16" 
            fill="none" 
            stroke={colorDef.stroke} 
            strokeWidth="0.5" 
            strokeDasharray="2 2"
            opacity="0.3"
          />
          
          {/* Eyes */}
          <g className="robot-eyes" filter={`url(#glow-filter-${seed})`}>
            {renderEye(eyeElements.leftEye, `url(#eye-glow-${seed})`, "robot-eye left")}
            {renderEye(eyeElements.rightEye, `url(#eye-glow-${seed})`, "robot-eye right")}
          </g>
          
          {/* Eye highlights */}
          {eyeElements.leftEye && eyeElements.leftEye.type !== "rect" && (
            <ellipse
              cx={(eyeElements.leftEye.cx || eyeElements.leftEye.x + eyeElements.leftEye.width/2) + eyeElements.highlight.offsetX}
              cy={(eyeElements.leftEye.cy || eyeElements.leftEye.y + eyeElements.leftEye.height/2) + eyeElements.highlight.offsetY}
              rx={eyeElements.highlight.rx}
              ry={eyeElements.highlight.ry}
              fill="#fff"
              opacity="0.9"
              className="robot-eye-shine"
            />
          )}
          {eyeElements.rightEye && eyeElements.rightEye.type !== "rect" && (
            <ellipse
              cx={(eyeElements.rightEye.cx || eyeElements.rightEye.x + eyeElements.rightEye.width/2) + eyeElements.highlight.offsetX}
              cy={(eyeElements.rightEye.cy || eyeElements.rightEye.y + eyeElements.rightEye.height/2) + eyeElements.highlight.offsetY}
              rx={eyeElements.highlight.rx}
              ry={eyeElements.highlight.ry}
              fill="#fff"
              opacity="0.9"
              className="robot-eye-shine"
            />
          )}
          {eyeElements.leftEye && eyeElements.leftEye.type === "rect" && !eyeElements.rightEye && (
            <ellipse
              cx={eyeElements.leftEye.x + eyeElements.highlight.offsetX + 5}
              cy={eyeElements.leftEye.y + eyeElements.leftEye.height/2 + eyeElements.highlight.offsetY}
              rx={eyeElements.highlight.rx}
              ry={eyeElements.highlight.ry}
              fill="#fff"
              opacity="0.7"
              className="robot-eye-shine"
            />
          )}
          
          {/* Mouth/speaker grille */}
          <g className="robot-mouth" opacity="0.4">
            <line x1="44" y1="62" x2="56" y2="62" stroke={colorDef.stroke} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="46" y1="65" x2="54" y2="65" stroke={colorDef.stroke} strokeWidth="1" strokeLinecap="round" />
          </g>
          
          {/* Chest light/indicator */}
          <circle 
            cx="50" 
            cy="79" 
            r="2.5" 
            fill={eyeGlow}
            className="robot-chest-light"
            filter={`url(#glow-filter-${seed})`}
          />
        </g>
      </svg>
    </span>
  );
}

export function RobotAvatarPreview({ color, shape, face, size = 80 }) {
  const colorDef = avatarColors.find(c => c.id === color) || avatarColors[0];
  const seed = 42;
  const headPath = getHeadPath(shape, 100);
  const eyeElements = getEyeElements(face, seed);
  const antennaStyle = "single";
  
  const highlightColor = lightenColor(colorDef.fill, 0.45);
  const bodyColor = darkenColor(colorDef.fill, 0.18);
  const shadowColor = darkenColor(colorDef.stroke, 0.35);
  const rimColor = lightenColor(colorDef.fill, 0.35);
  const eyeGlow = colorDef.accent || lightenColor(colorDef.fill, 0.15);
  const eyeBright = lightenColor(eyeGlow, 0.45);

  return (
    <span
      className="robot-avatar-preview robot-idle"
      style={{ 
        width: size, 
        height: size, 
        display: 'inline-flex',
        filter: 'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.1)) drop-shadow(0 6px 12px rgba(0, 0, 0, 0.08))'
      }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <linearGradient id="preview-head-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={highlightColor} />
            <stop offset="35%" stopColor={colorDef.fill} />
            <stop offset="100%" stopColor={bodyColor} />
          </linearGradient>
          <linearGradient id="preview-body-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={colorDef.fill} />
            <stop offset="100%" stopColor={shadowColor} />
          </linearGradient>
          <radialGradient id="preview-eye-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={eyeBright} />
            <stop offset="60%" stopColor={eyeGlow} />
            <stop offset="100%" stopColor={darkenColor(eyeGlow, 0.3)} />
          </radialGradient>
          <radialGradient id="preview-rim-light" cx="80%" cy="20%" r="60%">
            <stop offset="0%" stopColor={rimColor} stopOpacity="0.75" />
            <stop offset="100%" stopColor={rimColor} stopOpacity="0" />
          </radialGradient>
          <filter id="preview-shadow" x="-20%" y="-10%" width="140%" height="150%">
            <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#000" floodOpacity="0.25" />
          </filter>
          <filter id="preview-glow-filter" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
            <feColorMatrix in="blur" type="saturate" values="1.3" result="saturatedBlur" />
            <feMerge>
              <feMergeNode in="saturatedBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        
        <g className="robot-body" filter="url(#preview-shadow)">
          <ellipse cx="50" cy="88" rx="18" ry="4" fill="#000" opacity="0.2" />
          
          <path
            d="M 38 72 L 38 82 Q 38 86 42 86 L 58 86 Q 62 86 62 82 L 62 72"
            fill="url(#preview-body-grad)"
            stroke={colorDef.stroke}
            strokeWidth="2"
          />
          
          <ellipse cx="32" cy="78" rx="4" ry="3" fill={bodyColor} stroke={colorDef.stroke} strokeWidth="1.2" />
          <ellipse cx="68" cy="78" rx="4" ry="3" fill={bodyColor} stroke={colorDef.stroke} strokeWidth="1.2" />
          
          <path
            d={headPath}
            fill="url(#preview-head-grad)"
            stroke={colorDef.stroke}
            strokeWidth="2"
          />
          
          <path
            d={headPath}
            fill="url(#preview-rim-light)"
            stroke="none"
          />
          
          <g className="robot-antenna">
            <line x1="50" y1="25" x2="50" y2="14" stroke={colorDef.stroke} strokeWidth="2" strokeLinecap="round" />
            <circle cx="50" cy="11" r="4" fill={eyeGlow} className="antenna-orb" filter="url(#preview-glow-filter)" />
          </g>
          
          <ellipse 
            cx="50" 
            cy="52" 
            rx="20" 
            ry="16" 
            fill="none" 
            stroke={colorDef.stroke} 
            strokeWidth="0.5" 
            strokeDasharray="2 2"
            opacity="0.3"
          />
          
          <g className="robot-eyes" filter="url(#preview-glow-filter)">
            {renderEye(eyeElements.leftEye, "url(#preview-eye-glow)", "robot-eye left")}
            {renderEye(eyeElements.rightEye, "url(#preview-eye-glow)", "robot-eye right")}
          </g>
          
          {eyeElements.leftEye && eyeElements.leftEye.type !== "rect" && (
            <ellipse
              cx={(eyeElements.leftEye.cx || eyeElements.leftEye.x + eyeElements.leftEye.width/2) + eyeElements.highlight.offsetX}
              cy={(eyeElements.leftEye.cy || eyeElements.leftEye.y + eyeElements.leftEye.height/2) + eyeElements.highlight.offsetY}
              rx={eyeElements.highlight.rx}
              ry={eyeElements.highlight.ry}
              fill="#fff"
              opacity="0.9"
            />
          )}
          {eyeElements.rightEye && eyeElements.rightEye.type !== "rect" && (
            <ellipse
              cx={(eyeElements.rightEye.cx || eyeElements.rightEye.x + eyeElements.rightEye.width/2) + eyeElements.highlight.offsetX}
              cy={(eyeElements.rightEye.cy || eyeElements.rightEye.y + eyeElements.rightEye.height/2) + eyeElements.highlight.offsetY}
              rx={eyeElements.highlight.rx}
              ry={eyeElements.highlight.ry}
              fill="#fff"
              opacity="0.9"
            />
          )}
          
          <g className="robot-mouth" opacity="0.4">
            <line x1="44" y1="62" x2="56" y2="62" stroke={colorDef.stroke} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="46" y1="65" x2="54" y2="65" stroke={colorDef.stroke} strokeWidth="1" strokeLinecap="round" />
          </g>
          
          <circle 
            cx="50" 
            cy="79" 
            r="2.5" 
            fill={eyeGlow}
            className="robot-chest-light"
            filter="url(#preview-glow-filter)"
          />
        </g>
      </svg>
    </span>
  );
}
