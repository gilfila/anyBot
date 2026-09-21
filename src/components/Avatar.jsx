import { Bot } from "lucide-react";
import { presets } from "../constants.js";

export function Avatar({ employee, small = false }) {
  return (
    <span
      className={`avatar ${presets.find((p) => p.harness === employee?.harness)?.color || "blue"} ${small ? "small" : ""}`}
    >
      {employee?.name?.slice(0, 1) || <Bot size={20} />}
    </span>
  );
}
