import { Workflow } from "lucide-react";

export function Empty({ title, text }) {
  return (
    <div className="empty">
      <Workflow size={34} />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
