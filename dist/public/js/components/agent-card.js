/**
 * Agent card component — shows agent status with live indicators.
 */

// eslint-disable-next-line no-unused-vars
const AgentCard = {
  /** Agent name -> color index mapping (stable per session) */
  _colorMap: new Map(),

  getColor(name) {
    if (!this._colorMap.has(name)) {
      this._colorMap.set(name, this._colorMap.size % 5);
    }
    return this._colorMap.get(name);
  },

  resetColors() {
    this._colorMap.clear();
  },

  render(agents, container) {
    if (!agents || agents.length === 0) {
      container.innerHTML = '<div class="empty-state">No agents</div>';
      return;
    }

    container.innerHTML = agents.map((agent) => {
      const colorIdx = AgentCard.getColor(agent.name);
      const statusClass = agent.status || 'idle';

      return `
        <div class="agent-card ${statusClass}" data-agent="${agent.name}" onclick="App.filterByAgent('${AgentCard.escape(agent.name)}')">
          <div class="agent-card-header">
            <span class="agent-name agent-color-${colorIdx}">${AgentCard.escape(agent.name)}</span>
            <span class="agent-indicator ${statusClass}" title="${statusClass}"></span>
          </div>
          <div class="agent-detail">
            <div class="agent-stat">
              <span>backend</span>
              <span>${agent.backend || 'unknown'}</span>
            </div>
            ${agent.model ? `<div class="agent-stat"><span>model</span><span>${agent.model}</span></div>` : ''}
            <div class="agent-stat">
              <span>messages</span>
              <span>${agent.messageCount ?? 0}</span>
            </div>
            <div class="agent-stat">
              <span>status</span>
              <span>${statusClass}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  /**
   * Update a single agent card's status without full re-render.
   */
  updateStatus(container, agentName, status) {
    const card = container.querySelector(`[data-agent="${agentName}"]`);
    if (!card) return;

    card.className = `agent-card ${status}`;
    const indicator = card.querySelector('.agent-indicator');
    if (indicator) {
      indicator.className = `agent-indicator ${status}`;
      indicator.title = status;
    }
    // Update status text
    const statDivs = card.querySelectorAll('.agent-stat');
    const statusDiv = statDivs[statDivs.length - 1];
    if (statusDiv) {
      statusDiv.lastElementChild.textContent = status;
    }
  },

  escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
