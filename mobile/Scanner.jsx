import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { X } from "lucide-react";

// Full-screen camera that reads the desktop's QR code. Decoding happens on
// the phone (jsQR); no image leaves it.
export function Scanner({ onResult, onClose }) {
  const video = useRef(null);
  const canvas = useRef(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let stream = null;
    let frame = 0;
    let stopped = false;
    let last = 0;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (error) {
        setProblem(
          error?.name === "NotAllowedError"
            ? "Any Bot needs the camera to scan the code. Allow it in your phone's settings, or paste the code instead."
            : "The camera couldn't start. Paste the code instead.",
        );
        return;
      }
      if (stopped) return stop();
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      const tick = (time) => {
        if (stopped) return;
        frame = requestAnimationFrame(tick);
        const v = video.current;
        if (time - last < 150 || !v || v.readyState < 2 || !v.videoWidth) return;
        last = time;
        const width = 640;
        const height = Math.round((width * v.videoHeight) / v.videoWidth);
        const c = canvas.current;
        c.width = width;
        c.height = height;
        const context = c.getContext("2d", { willReadFrequently: true });
        context.drawImage(v, 0, 0, width, height);
        const code = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: "dontInvert" });
        if (code?.data) {
          stop();
          onResult(code.data);
        }
      };
      frame = requestAnimationFrame(tick);
    })();
    return stop;
  }, []);
  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label="Scan the code on your computer">
      <video ref={video} playsInline muted />
      <canvas ref={canvas} hidden />
      <div className="scanner-frame" aria-hidden="true" />
      <p className="scanner-hint">{problem || "Point your camera at the code on your computer."}</p>
      <button type="button" className="scanner-close" aria-label="Cancel scanning" onClick={onClose}>
        <X size={22} />
      </button>
    </div>
  );
}
