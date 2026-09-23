import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

// A popup menu rendered at the top of the page, positioned from the button
// that opened it. Menus inside scrolling lists (the sidebar's bot list) can't
// be clipped or stretch the list this way. Opens below the button, or above
// when there isn't room; takes focus; closes on scroll, resize, and Escape.
export function FloatingMenu({ anchor, label, onClose, children, className = "" }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Placed before paint, straight on the element, then focused.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const button = anchor?.getBoundingClientRect() || { top: 0, bottom: 0, right: 0 };
    const size = menu.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    let top = button.bottom + gap;
    if (top + size.height > window.innerHeight - margin) top = Math.max(margin, button.top - gap - size.height);
    const left = Math.min(Math.max(margin, button.right - size.width), window.innerWidth - size.width - margin);
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.querySelector('[role="menuitem"]')?.focus();
  }, [anchor]);

  useEffect(() => {
    const dismiss = () => close.current();
    const onScroll = (event) => {
      if (!ref.current?.contains(event.target)) dismiss();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, []);

  const onKeyDown = (event) => {
    const items = [...ref.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    const move = (next) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      close.current();
      anchor?.focus();
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={`floating-menu ${className}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}
