import React, { useEffect, useState } from "react";
import { File, FileImage, Folder, X } from "lucide-react";
import { formatSize, isImageName, messageAttachments } from "../../lib/attachments.js";
import { useFileActions } from "../FileLinks.jsx";

const Icon = ({ item }) =>
  item.kind === "folder" ? <Folder size={15} /> : isImageName(item.name) ? <FileImage size={15} /> : <File size={15} />;

// The composer's pending attachments, each removable.
export function AttachmentTray({ items, onRemove }) {
  if (!items.length) return null;
  return (
    <ul className="attachment-tray" aria-label="Attachments">
      {items.map((item) => (
        <li key={item.path} className={item.thumbnail ? "attachment-chip has-thumb" : "attachment-chip"} title={item.path}>
          {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <Icon item={item} />}
          <span className="attachment-name">{item.kind === "folder" ? `${item.name}/` : item.name}</span>
          {item.size ? <small>{formatSize(item.size)}</small> : null}
          <button type="button" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.path)}>
            <X size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

// Thumbnails for stored images, fetched once per message and position.
const previews = new Map();
function useThumbnail(message, index, wanted) {
  const key = `${message}:${index}`;
  const [url, setUrl] = useState(previews.get(key) || "");
  useEffect(() => {
    if (!wanted || previews.has(key)) return;
    let live = true;
    window.anybot
      ?.request("attachments.preview", { message, index })
      .then((result) => {
        const value = result?.kind === "image" ? result.url : "";
        previews.set(key, value);
        if (live) setUrl(value);
      })
      .catch(() => previews.set(key, ""));
    return () => {
      live = false;
    };
  }, [key, wanted]);
  return url;
}

// A sent attachment acts like a file link to its path (FileLinks.jsx): click
// opens or previews it (a folder opens), Shift+click shows it in its folder,
// and right-click or the Menu key has the rest. The thumbnail comes from
// attachments.preview, which is scoped to the message.
function StoredAttachment({ message, index, item, actions }) {
  const thumbnail = useThumbnail(message, index, item.kind === "file" && isImageName(item.name));
  return (
    <li>
      <button
        type="button"
        className={thumbnail ? "attachment-chip has-thumb" : "attachment-chip"}
        title={`${item.path}\nClick to open · Shift+click to show in folder · Right-click for more`}
        disabled={!actions}
        onClick={(event) => actions?.open(item.path, event.currentTarget, event.shiftKey)}
        onContextMenu={(event) => {
          if (!actions) return;
          event.preventDefault();
          actions.menu(item.path, event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (actions && (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))) {
            event.preventDefault();
            actions.menu(item.path, event.currentTarget);
          }
        }}
      >
        {thumbnail ? <img src={thumbnail} alt={item.name} /> : <Icon item={item} />}
        <span className="attachment-name">{item.kind === "folder" ? `${item.name}/` : item.name}</span>
        {item.size ? <small>{formatSize(item.size)}</small> : null}
      </button>
    </li>
  );
}

// What the owner attached to a sent message.
export function MessageAttachments({ message }) {
  const actions = useFileActions(message.id);
  const items = messageAttachments(message);
  if (!items.length) return null;
  return (
    <ul className="message-attachments" aria-label="Attached">
      {items.map((item, index) => (
        <StoredAttachment key={`${item.path}:${index}`} message={message.id} index={index} item={item} actions={actions} />
      ))}
      {actions?.element}
    </ul>
  );
}
