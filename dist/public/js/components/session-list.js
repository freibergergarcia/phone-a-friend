/**
 * Session list component — renders session cards.
 */

// eslint-disable-next-line no-unused-vars
const SessionList = {
  render(sessions, container) {
    if (!sessions || sessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No agentic sessions yet.</p>
          <p style="margin-top: 8px; font-size: 11px; color: var(--text-muted)">
            Run one with: <code>phone-a-friend agentic run --agents reviewer:claude,critic:claude --prompt "..."</code>
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = sessions.map((s) => {
      const agents = (s.agents || []);
      const agentChips = agents.map((a) =>
        `<span class="agent-chip">${SessionList.escape(a.name)}</span>`
      ).join('');
      const time = SessionList.formatTime(s.createdAt);
      const prompt = SessionList.truncate(s.prompt || '', 120);
      const statusClass = s.status || 'completed';
      const elapsed = SessionList.formatElapsed(s.createdAt, s.endedAt);
      const msgCount = agents.reduce((sum, a) => sum + (a.messageCount ?? 0), 0);

      return `
        <div class="session-card" data-id="${s.id}" onclick="App.viewSession('${s.id}')">
          <div class="session-card-header">
            <span class="session-id">${s.id}</span>
            <span class="status-pill ${statusClass}">${s.status}</span>
            <span class="session-time">${time}</span>
          </div>
          <div class="session-card-prompt">${SessionList.escape(prompt)}</div>
          <div class="session-card-footer">
            <div class="session-card-agents">${agentChips}</div>
            <div class="session-card-stats">
              <span>${msgCount} msg</span>
              <span>${elapsed}</span>
            </div>
          </div>
          <button class="session-delete" onclick="App.deleteSession('${s.id}', event)" title="Delete">&times;</button>
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

  formatElapsed(startStr, endStr) {
    try {
      const start = new Date(startStr);
      const end = endStr ? new Date(endStr) : new Date();
      const sec = (end - start) / 1000;
      if (sec < 60) return sec.toFixed(1) + 's';
      if (sec < 3600) return Math.floor(sec / 60) + 'm ' + Math.floor(sec % 60) + 's';
      return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
    } catch {
      return '\u2014';
    }
  },

  escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
