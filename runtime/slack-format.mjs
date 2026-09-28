// Pure Slack helpers shared by the bridge (runtime/slack-bridge.mjs) and the
// Connect to Slack panel (src/components/SlackPanel.jsx).

// Scopes and events the bridge uses; nothing more is asked for.
export const SLACK_SCOPES = [
  "app_mentions:read",
  "chat:write",
  "im:history",
  "im:read",
  "im:write",
  "reactions:write",
  "users:read",
];

// A Socket Mode app for one bot: DMs, @mentions in channels, and buttons for
// approvals. Socket Mode means Slack never needs to reach this computer.
export function slackManifest(name) {
  const title = String(name || "Any Bot").trim().slice(0, 35) || "Any Bot";
  return {
    display_information: {
      name: title,
      description: `${title}, a teammate from Any Bot`.slice(0, 140),
    },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: title, always_online: true },
    },
    oauth_config: { scopes: { bot: SLACK_SCOPES } },
    settings: {
      event_subscriptions: { bot_events: ["app_mention", "message.im"] },
      interactivity: { is_enabled: true },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };
}

// Slack's "Create an app" page, prefilled with the manifest.
export function slackCreateAppUrl(name) {
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest(name)))}`;
}

const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A bot's markdown as Slack mrkdwn: bold, headings, links, and bullets
// converted; code kept as code; &, <, > escaped as Slack requires.
export function toSlackText(markdown) {
  const parts = String(markdown || "").split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, index) => {
      if (index % 2) return escape(part.replace(/^```[\w+-]*\n/, "```\n"));
      return part
        .split(/(`[^`\n]+`)/g)
        .map((piece, i) => {
          if (i % 2) return escape(piece);
          return escape(piece)
            .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => `<${url}|${text}>`)
            .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
            .replace(/__([^_\n]+)__/g, "_$1_")
            .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
            .replace(/^(\s*)[-*]\s+/gm, "$1• ");
        })
        .join("");
    })
    .join("");
}

// Slack text from a person as plain text: mentions, channels, and links
// unwrapped, entities decoded.
export function fromSlackText(text, botUser) {
  return String(text || "")
    .replace(new RegExp(`<@${botUser}>\\s*`, "g"), "")
    .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, name) => `@${name || id}`)
    .replace(/<#([A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id, name) => `#${name || id}`)
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/<mailto:([^|>]+)(?:\|[^>]+)?>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

// Slack caps a message at 40k characters and renders long ones poorly; split
// on paragraph, then line, then hard boundaries.
export function slackChunks(text, max = 3500) {
  const chunks = [];
  let rest = String(text || "");
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < max / 2) cut = window.lastIndexOf("\n");
    if (cut < max / 2) cut = max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest.trim() || !chunks.length) chunks.push(rest);
  return chunks;
}
