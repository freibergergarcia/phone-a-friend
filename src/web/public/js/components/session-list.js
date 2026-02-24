/**
 * Session list component — renders session rows.
 */

// eslint-disable-next-line no-unused-vars
const SessionList = {
  render(sessions, container) {
    if (!sessions || sessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No agentic sessions yet.</p>
          <p style="margin-top: 8px; font-size: 11px; color: var(--text-muted)">
            Run one with: <code style="color: var(--accent)">phone-a-friend agentic run --agents reviewer:claude,critic:claude --prompt "..."</code>
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = sessions.map((s) => {
      const agents = (s.agents || []).map((a) => a.name).join(', ');
      const time = SessionList.formatTime(s.createdAt);
      const prompt = SessionList.truncate(s.prompt || '', 50);
      const statusClass = s.status || 'completed';

      return `
        <div class="session-row" data-id="${s.id}" onclick="App.viewSession('${s.id}')">
          <span class="session-id">${s.id}</span>
          <span class="status-pill ${statusClass}">${s.status}</span>
          <span class="session-prompt">${SessionList.escape(prompt)}</span>
          <span class="session-agents">${SessionList.escape(agents)}</span>
          <span class="session-time">${time}</span>
        </div>
      `;
    }).join('');
  },

  formatTime(dateStr) {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString([], {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  },

  truncate(text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + '\u2026';
  },

  escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
