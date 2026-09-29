import React from "react";
import { ChevronDown } from "lucide-react";

// A sidebar section heading that folds its section away.
export function SectionToggle({ name, label, count, folded, onToggle }) {
  return (
    <button
      type="button"
      className="section-toggle"
      aria-expanded={!folded}
      title={folded ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}
      onClick={() => onToggle(name)}
    >
      <ChevronDown size={13} className={folded ? "chevron folded" : "chevron"} aria-hidden="true" />
      {label}
      {count !== undefined && <span>{count}</span>}
    </button>
  );
}
