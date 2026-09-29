// Each bot's direct chat is its first open one-bot conversation (the same rule
// as the coordinator's directConversation). Its sidebar row opens it.
export function primaryChats(conversations) {
  const chats = new Map();
  for (const conversation of conversations)
    if (!conversation.archived && conversation.members.length === 1 && !chats.has(conversation.members[0]))
      chats.set(conversation.members[0], conversation.id);
  return new Set(chats.values());
}

// Conversations listed under Projects: every project (two or more bots), and
// any other one-bot conversation (a project created with, or trimmed to, one
// bot), which would otherwise be unreachable, uneditable and undeletable.
export function sidebarProjects(conversations) {
  const chats = primaryChats(conversations);
  return conversations.filter((c) => c.members.length > 1 || !chats.has(c.id));
}
