// Turns employee markdown into something worth hearing. Voice replies are a
// summary: code, tables and artifact manifests stay in the chat, and long
// answers are cut to a few sentences with a pointer back to the transcript.

const MORE = "The full details are in the chat.";

export function toSpeech(markdown, { maxSentences = 3, maxChars = 420 } = {}) {
  let text = String(markdown ?? "").replace(/\r\n?/g, "\n");
  let omitted = false;
  text = text.replace(/```anybot-artifacts[\s\S]*?(```|$)/g, "");
  text = text.replace(/```[\s\S]*?(```|$)/g, () => {
    omitted = true;
    return "\n";
  });
  const lines = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line) {
      lines.push("");
      continue;
    }
    if (/^\|.*\|$/.test(line) || /^[-:| ]+$/.test(line)) {
      omitted = true;
      continue;
    }
    line = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "a link")
      .replace(/<[^>]+>/g, "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) continue;
    // Headings and list items rarely end in punctuation; give each a stop so
    // the voice pauses between them instead of running them together.
    lines.push(/[.!?:;]$/.test(line) ? line : `${line}.`);
  }
  const prose = lines.join(" ").replace(/\s+/g, " ").trim();
  const sentences = splitSentences(prose);
  let spoken = "";
  let used = 0;
  for (const sentence of sentences) {
    if (used >= maxSentences) break;
    const next = spoken ? `${spoken} ${sentence}` : sentence;
    if (next.length > maxChars) {
      if (!spoken) spoken = `${sentence.slice(0, maxChars).replace(/\s+\S*$/, "")}…`;
      break;
    }
    spoken = next;
    used += 1;
  }
  if (spoken.length < prose.length) omitted = true;
  if (!spoken) return omitted ? MORE : "";
  return omitted ? `${spoken} ${MORE}` : spoken;
}

export function splitSentences(text) {
  return (
    String(text)
      // A stop only ends a sentence when whitespace or the end follows, so
      // file names and versions ("report.md", "0.2.27") stay whole.
      .match(/[^]+?(?:[.!?…]+["')\]]*(?=\s|$)|$)/g)
      ?.map((part) => part.trim())
      .filter(Boolean) ?? []
  );
}

// System voices cut off long utterances on some Chromium builds; speak in
// sentence-sized chunks instead.
export function speechChunks(text, maxChars = 200) {
  const chunks = [];
  let current = "";
  for (const sentence of splitSentences(text)) {
    if (current && `${current} ${sentence}`.length > maxChars) {
      chunks.push(current);
      current = "";
    }
    if (sentence.length > maxChars) {
      for (const piece of sentence.match(new RegExp(`.{1,${maxChars}}(?:\\s|$)`, "g")) ?? [])
        chunks.push(piece.trim());
      continue;
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}
