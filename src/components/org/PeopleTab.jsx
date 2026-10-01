import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Play, UserCheck } from "lucide-react";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { FIRE_RULES, RULES, VERDICTS, VERDICT_LABELS, totalsLine } from "../../../runtime/people-review.mjs";
import { filterPeople, peopleRows, sortPeople, trendLabel, trendOf } from "../../lib/people.js";
import "./people.css";

// Org → People: the daily people review (runtime/people-review.mjs). Every
// bot's verdict, key numbers, reasons and one suggested fix, sortable and
// filtered by verdict. Clicking a bot opens its panel. Read-only: Run now
// reviews again, nothing else changes anything. It fetches the review again
// whenever the snapshot's `people` stamp changes (a review ran, or the
// settings changed), so a review that runs while it's open shows up.
const COLUMNS = [
  ["name", "Bot"],
  ["verdict", "Verdict"],
  ["runs", "Runs, 14 days"],
  ["failures", "Failed"],
  ["cost", "Tokens a task"],
  ["sentBack", "Sent back"],
  ["redo", "Redone"],
];
const clean = (message) => String(message || "").replace(/^Error invoking remote method '[^']+': Error: /, "");
const percent = (value) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`);
const tokens = (value) =>
  value === null || value === undefined ? "—" : value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
const when = (time) =>
  new Date(time).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

function Trend({ history, id }) {
  const days = trendOf(history, id).slice(-14);
  if (days.length < 2) return null;
  return (
    <span className="people-trend" role="img" aria-label={trendLabel(days)}>
      {days.map((day) => (
        <i key={day.day} aria-hidden="true" className={`is-${day.v || "none"}`} title={`${day.day}: ${day.v ? VERDICT_LABELS[day.v] : "not reviewed"}`} />
      ))}
    </span>
  );
}

export function PeopleTab({ data, selected, onSelect }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [sort, setSort] = useState({ key: "verdict", dir: "desc" });
  const [verdict, setVerdict] = useState("all");
  const stamp = JSON.stringify(data.people ?? null);
  useEffect(() => {
    if (!window.anybot) return undefined;
    let live = true;
    window.anybot
      .request("people.review")
      .then((next) => {
        if (!live) return;
        setState(next);
        setError("");
      })
      .catch((e) => live && setError(clean(e.message)));
    return () => {
      live = false;
    };
  }, [stamp]);
  const all = useMemo(() => peopleRows(state?.latest, data.employees), [state, data.employees]);
  const rows = useMemo(() => sortPeople(filterPeople(all, verdict), sort.key, sort.dir), [all, verdict, sort]);
  const runNow = async () => {
    setRunning(true);
    setError("");
    try {
      setState(await window.anybot.request("people.run"));
    } catch (e) {
      setError(clean(e.message));
    } finally {
      setRunning(false);
    }
  };
  const sortBy = (key) =>
    setSort((current) => ({ key, dir: current.key === key ? (current.dir === "asc" ? "desc" : "asc") : key === "name" ? "asc" : "desc" }));
  const latest = state?.latest;
  const settings = state?.settings;
  const active = data.employees.filter((e) => !e.archived);

  if (!active.length)
    return (
      <div className="reports-empty">
        <UserCheck size={22} />
        <p>Hire a few bots first. Each morning this page shows which ones need adjusting, and why.</p>
      </div>
    );
  return (
    <div className="people-review">
      <section className="people-card people-head" aria-labelledby="people-title">
        <div>
          <h2 id="people-title">Daily people review</h2>
          <p className="people-summary">{latest ? totalsLine(latest) : "No review yet."}</p>
          <p className="people-note">
            {settings?.enabled
              ? `Runs every day at ${settings.at}${settings.next ? ` (next: ${when(settings.next)})` : ""}, or when Any Bot next starts if it missed it.`
              : "The daily review is off (Settings → Team). Run now still works."}{" "}
            It reads the last 14 days, uses no tokens and changes nothing: each suggested fix is yours to make.
          </p>
        </div>
        <button type="button" className="secondary" disabled={running || !window.anybot} onClick={runNow}>
          <Play size={14} />
          {running ? "Reviewing…" : "Run now"}
        </button>
      </section>
      {error && (
        <p className="people-error" role="alert">
          {error}
        </p>
      )}
      {latest && (
        <div className="people-filters" role="group" aria-label="Show bots by verdict">
          {["all", ...VERDICTS].map((key) => {
            const count = key === "all" ? all.length : all.filter((row) => row.v === key).length;
            return (
              <button key={key} type="button" aria-pressed={verdict === key} className={`people-filter is-${key}`} onClick={() => setVerdict(key)}>
                {key === "all" ? "All" : VERDICT_LABELS[key]} <span>{count}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="people-card people-table-wrap">
        <table className="people-table">
          <thead>
            <tr>
              {COLUMNS.map(([key, label]) => (
                <th key={key} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => sortBy(key)}>
                    {label}
                    {sort.key === key && (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
              ))}
              <th>Why</th>
              <th>Suggested fix</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="people-none">
                  No bot has this verdict in the latest review.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className={row.id === selected ? "is-selected" : ""}>
                <td>
                  <button type="button" className="people-bot" title={`Open ${row.name}'s panel`} onClick={() => onSelect(row.id)}>
                    <RobotAvatar small employee={row.employee} />
                    <span>
                      <strong>{row.name}</strong>
                      <small>{row.employee?.role}</small>
                    </span>
                  </button>
                </td>
                <td>
                  <span className={`people-chip is-${row.v || "none"}`}>{row.label}</span>
                  {row.was && <small className="people-was">was {row.was}</small>}
                  <Trend history={state?.history || []} id={row.id} />
                </td>
                <td className="num">
                  {row.runs ?? "—"}
                  {row.today ? <small> {row.today} today</small> : null}
                </td>
                <td className="num" title={row.failRate === null ? undefined : `${percent(row.failRate)} of its runs that ended`}>
                  {row.failed ?? "—"}
                </td>
                <td className="num">{tokens(row.cost)}</td>
                <td className="num">{row.reviews ? `${row.sentBack} of ${row.reviews}` : "—"}</td>
                <td className="num">{row.redo ?? "—"}</td>
                <td className="people-why">
                  {row.reasons.length || row.notes.length ? (
                    <ul>
                      {row.reasons.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                      {row.notes.map((text) => (
                        <li key={text} className="muted">
                          {text}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="muted">
                      {row.v === "insufficient" ? "Fewer than 10 finished runs or reviews to judge by (outages don't count)" : row.v ? "Nothing stands out" : ""}
                    </span>
                  )}
                </td>
                <td className="people-fix">
                  {row.fix ? (
                    <>
                      <strong>{row.fix.kind}</strong> {row.fix.text}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="people-card people-rules">
        <summary>How verdicts are decided</summary>
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Counts</th>
              <th>Least data</th>
              <th>Watch</th>
              <th>Adjust</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {RULES.map((rule) => (
              <tr key={rule.code}>
                <td>{rule.label}</td>
                <td>{rule.counts}</td>
                <td>{rule.min}</td>
                <td>{rule.watch || "—"}</td>
                <td>{rule.adjust || "—"}</td>
                <td>{rule.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Rates are judged by the low end of their likely range (a Wilson lower bound), so a few bad runs never flag a bot.
          Below a rule's least data it isn't judged; a bot with no rule judged is <strong>Not enough data</strong>.
        </p>
        <h3>Fire candidates</h3>
        <ul>
          {FIRE_RULES.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
