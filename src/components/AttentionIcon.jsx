import React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, GitPullRequest, ShieldAlert } from "lucide-react";

// The icon beside a bot's name that says what it needs from you
// (src/lib/attention.js decides which).
const ICONS = {
  approval: ShieldAlert,
  error: AlertCircle,
  question: AlertTriangle,
  pr: GitPullRequest,
  done: CheckCircle2,
};

export function AttentionIcon({ attention }) {
  if (!attention) return null;
  const Icon = ICONS[attention.kind];
  const title = attention.detail ? `${attention.label}: ${attention.detail}` : attention.label;
  return (
    <span className={`attention attention-${attention.kind}`} role="img" aria-label={attention.label} title={title}>
      <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}
