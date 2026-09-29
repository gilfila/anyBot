// Zoom for the org chart canvas. Pure; OrgPage.jsx applies it.
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 1.5;
const STEPS = [0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5];

export const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value) || 1));

// The next preset step in or out from the current zoom.
export function stepZoom(zoom, direction) {
  const current = clampZoom(zoom);
  if (direction > 0) return STEPS.find((step) => step > current + 0.001) ?? MAX_ZOOM;
  return [...STEPS].reverse().find((step) => step < current - 0.001) ?? MIN_ZOOM;
}

// The largest zoom (never above 100%) that shows the whole chart.
export function fitZoom(content, view, padding = 32) {
  if (!content.width || !content.height || !view.width || !view.height) return 1;
  const scale = Math.min((view.width - padding) / content.width, (view.height - padding) / content.height);
  return clampZoom(Math.min(1, scale));
}

// Ctrl + wheel / trackpad pinch: smooth, proportional to how far it scrolled.
export const wheelZoom = (zoom, deltaY) => clampZoom(zoom * Math.exp(-deltaY * 0.0015));

// Scroll position that keeps the point under the cursor (offset from the
// canvas's top-left) in place when the zoom changes.
export function anchoredScroll(scroll, offset, from, to) {
  const ratio = to / from;
  return {
    left: Math.max(0, (scroll.left + offset.x) * ratio - offset.x),
    top: Math.max(0, (scroll.top + offset.y) * ratio - offset.y),
  };
}
