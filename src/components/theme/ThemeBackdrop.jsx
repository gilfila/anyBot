import React, { useEffect, useRef, useState } from "react";
import { prefersStill, useThemeState } from "../../lib/theme.js";
import meadowVideo from "../../themes/media/solarpunk.webm";
import meadowPoster from "../../themes/media/solarpunk.jpg";
import cityVideo from "../../themes/media/cyberpunk.webm";
import cityPoster from "../../themes/media/cyberpunk.jpg";
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
      {kind === "meadow" && <VideoScene kind="meadow" still={still} />}
      {kind === "grid" && <VideoScene kind="grid" still={still} />}
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

// Solarpunk and Cyberpunk play a looping scene (generated with Higgsfield:
// a still keyframe, animated with the same first and last frame so the loop
// has no seam). Motion off shows that keyframe instead, and playback pauses
// while the window is hidden.
const SCENES = {
  meadow: { video: meadowVideo, poster: meadowPoster },
  grid: { video: cityVideo, poster: cityPoster },
};

function VideoScene({ kind, still }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  const scene = SCENES[kind];
  useEffect(() => {
    const video = ref.current;
    if (!video || still) return undefined;
    const sync = () => {
      if (document.hidden) video.pause();
      else video.play().catch(() => {});
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [still, kind]);
  return (
    <>
      <img className="scene-poster" src={scene.poster} alt="" />
      {!still && (
        <video
          ref={ref}
          key={kind}
          className={`scene-video${ready ? " is-ready" : ""}`}
          src={scene.video}
          poster={scene.poster}
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          onCanPlay={() => setReady(true)}
        />
      )}
      <div className={`scene-veil scene-veil-${kind}`} />
    </>
  );
}
