import React from "react";
import { RobotAvatar } from "./RobotAvatar.jsx";
import { dailyTotals, describeTokens } from "../lib/usage.js";

// Tokens each bot used today, from the counts its harness reported.
export function UsageToday({ runs, employees }) {
  const totals = dailyTotals(runs);
  if (!totals.length) return null;
  return (
    <section className="usage-today" aria-label="Tokens used today">
      <h2>Tokens today</h2>
      <ul>
        {totals.map((total) => {
          const bot = employees.find((e) => e.id === total.employee);
          return (
            <li key={total.employee}>
              <RobotAvatar size={28} employee={bot} />
              <strong>{bot?.name || "Former bot"}</strong>
              <span>
                {describeTokens(total)} · {total.runs} run{total.runs === 1 ? "" : "s"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
