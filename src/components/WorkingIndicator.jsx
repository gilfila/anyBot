import { Square } from "lucide-react";
import { RobotAvatar } from "./RobotAvatar.jsx";

export function WorkingIndicator({ runs, employees, onStopAll }) {
  if (!runs || runs.length === 0) return null;

  const workingEmployees = runs
    .map((r) => employees.find((e) => e.id === r.employee))
    .filter(Boolean);

  const uniqueEmployees = [...new Map(workingEmployees.map((e) => [e.id, e])).values()];

  const getStatusText = () => {
    if (uniqueEmployees.length === 0) return "Working";
    if (uniqueEmployees.length === 1) {
      return `${uniqueEmployees[0].name} is working`;
    }
    if (uniqueEmployees.length === 2) {
      return `${uniqueEmployees[0].name} and ${uniqueEmployees[1].name} are working`;
    }
    return `${uniqueEmployees.length} agents are working`;
  };

  return (
    <div className="working-indicator">
      <div className="working-indicator-shimmer" />
      <div className="working-indicator-avatars">
        {uniqueEmployees.slice(0, 3).map((employee) => (
          <RobotAvatar key={employee.id} employee={employee} size={52} working />
        ))}
        {uniqueEmployees.length > 3 && (
          <span className="working-indicator-overflow">
            +{uniqueEmployees.length - 3}
          </span>
        )}
      </div>
      <div className="working-indicator-text">
        <span>{getStatusText()}</span>
        <span className="working-indicator-dots">
          <i />
          <i />
          <i />
        </span>
      </div>
      {onStopAll && (
        <button
          className="working-indicator-stop"
          onClick={onStopAll}
          aria-label="Stop all running work"
        >
          <Square size={10} />
          Stop all
        </button>
      )}
    </div>
  );
}
