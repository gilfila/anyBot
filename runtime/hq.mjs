// HQ: the top-level bot with the most people under it (the chief), and its
// open project ranked by how many of its direct reports are members. The
// people review writes its canvas section there (Coordinator.peopleHq), and
// the chat offers "Talk to <chief>" there (App.jsx). Pure over rows, so the
// runtime and the renderer (from its snapshot) pick the same room.
//
// bots: [{id, manager, archived}] and rooms: [{id, members: [ids], archived}],
// each in creation order (ties go to the first). Returns {employee,
// conversation} (conversation null when the chief is in no project), or null
// when no bot has anyone reporting to it.
export function findHq(bots = [], rooms = []) {
  const active = bots.filter((bot) => !bot.archived);
  const ids = new Set(active.map((bot) => bot.id));
  const reports = new Map();
  for (const bot of active) {
    if (!bot.manager || !ids.has(bot.manager)) continue;
    if (!reports.has(bot.manager)) reports.set(bot.manager, []);
    reports.get(bot.manager).push(bot.id);
  }
  const under = (id) => {
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length)
      for (const report of reports.get(queue.shift()) || []) {
        if (seen.has(report)) continue;
        seen.add(report);
        queue.push(report);
      }
    return seen.size - 1;
  };
  let top = null;
  let most = 0;
  for (const bot of active) {
    if (bot.manager && ids.has(bot.manager)) continue;
    const count = under(bot.id);
    if (count > most) {
      top = bot;
      most = count;
    }
  }
  if (!top) return null;
  const direct = new Set(reports.get(top.id) || []);
  const count = (room) => room.members.filter((member) => direct.has(member)).length;
  const room = rooms
    .filter((room) => !room.archived && room.members.length > 1 && room.members.includes(top.id))
    .sort((a, b) => count(b) - count(a))[0];
  return { employee: top.id, conversation: room?.id || null };
}
