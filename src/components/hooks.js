import { useEffect, useRef, useState } from "react";

// A Copy button's state: copy(text) puts text on the clipboard and shows
// "Copied" for a moment. A clipboard that refuses leaves the button as it was.
export function useCopy(ms = 1500) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text ?? ""));
    } catch {
      return false;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), ms);
    return true;
  };
  return [copied, copy];
}

// The current time, ticking every `ms` while `live` (a run's elapsed time).
export function useNow(live, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [live, ms]);
  return now;
}
