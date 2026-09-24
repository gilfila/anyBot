// Release notes arrive from the update feed as HTML (GitHub renders the
// release body). The update card shows them as a short plain-text excerpt.
const ENTITIES = { lt: "<", gt: ">", quot: '"', "#39": "'", amp: "&" };
const BOILERPLATE = /^(Windows installer and automatic update files\.|Download the Windows installer)$/;

export function plainNotes(notes, limit = 280) {
  const text = String(notes || "")
    .replace(/<\/(p|li|h[1-6]|ul|ol|div)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(lt|gt|quot|#39|amp);/g, (_, entity) => ENTITIES[entity])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !BOILERPLATE.test(line))
    .join("\n");
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}
