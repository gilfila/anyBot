import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Bot } from "lucide-react";
import {
  avatarColors,
  avatarHeadStyles,
  parseAvatarConfig,
  stringifyAvatarConfig,
} from "../lib/avatar-config.js";
import "./robot-avatar.css";

export { parseAvatarConfig, stringifyAvatarConfig };
export const AvatarActivityContext = createContext({});
const labels = {
  idle: "Ready",
  working: "Working",
  unread: "Completed work, unread reply",
};

export function RobotAvatar({
  employee,
  small = false,
  working = false,
  avatarConfig = null,
  size,
  animationState,
}) {
  const activities = useContext(AvatarActivityContext);
  const config = useMemo(
    () =>
      parseAvatarConfig(
        avatarConfig || employee?.avatar,
        employee?.name || employee?.id,
        employee?.harness,
      ),
    [
      avatarConfig,
      employee?.avatar,
      employee?.name,
      employee?.id,
      employee?.harness,
    ],
  );
  const activity =
    animationState ||
    activities[employee?.id] ||
    (working ? "working" : "idle");
  const pixels = size || (small ? 38 : 52);
  const color = avatarColors.find((c) => c.id === config.color);
  const model = avatarHeadStyles.find((s) => s.id === config.shape);
  const canvas = useRef(null),
    registered = useRef(null);
  const [ready, setReady] = useState(false);
  const identity =
    employee?.id && !animationState
      ? `employee:${employee.id}`
      : `preview:${config.shape}:${activity}`;
  const options = useMemo(
    () => ({ identity, config, activity, onReady: setReady }),
    [identity, config, activity],
  );
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    let disposed = false;
    import("../lib/bot-avatar-renderer.js")
      .then(({ registerAvatar }) => {
        if (!disposed && canvas.current)
          registered.current = registerAvatar(canvas.current, latest.current);
      })
      .catch(() => {
        if (!disposed) setReady(false);
      });
    return () => {
      disposed = true;
      registered.current?.();
      registered.current = null;
    };
  }, []);
  useEffect(() => {
    registered.current?.update?.(options);
  }, [options, pixels]);
  return (
    <span
      className={`robot-avatar robot-avatar-3d${small ? " small" : ""}`}
      style={{ width: pixels, height: pixels, "--bot-fill": color.css }}
      role="img"
      aria-label={`${employee?.name || model.name}: ${model.name}, ${color.name}. ${labels[activity] || labels.idle}`}
      title={`${employee?.name || model.name} · ${labels[activity] || labels.idle}`}
      data-avatar-state={activity}
      data-avatar-model={config.shape}
      data-renderer={ready ? "3d" : "fallback"}
    >
      {!ready && (
        <Bot
          className="robot-avatar-fallback"
          size={Math.round(pixels * 0.7)}
          aria-hidden="true"
        />
      )}
      <canvas
        ref={canvas}
        className={ready ? "ready" : ""}
        aria-hidden="true"
      />
    </span>
  );
}

export function RobotAvatarPreview({
  color,
  shape,
  face = "open",
  size = 156,
  animationState = "idle",
}) {
  const avatarConfig = useMemo(
    () => ({ color, shape, face }),
    [color, shape, face],
  );
  return (
    <RobotAvatar
      avatarConfig={avatarConfig}
      size={size}
      animationState={animationState}
    />
  );
}
