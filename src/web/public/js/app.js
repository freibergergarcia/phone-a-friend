/**
 * Main dashboard app — state management, routing, SSE connection.
 */

// eslint-disable-next-line no-unused-vars
const App = (() => {
  // State
  let sessions = [];
  let currentSessionId = null;
  let currentSession = null;
  let eventSource = null;
  let liveTurn = -1;

  // Filter state — which message types are visible
  const filters = { routed: true, notes: true, initial: true };
  let agentFilter = null; // null = show all, string = filter by agent name
  let statusPollTimer = null;

  // DOM refs (cached on init)
  let $listView, $detailView, $sessionList, $agentSidebar, $messageFeed;
  let $detailTitle, $detailStatus, $detailMeta, $turnInfo;
  let $stats, $sseBadge;

  // ---- Init ---------------------------------------------------------------

  function init() {
    $listView = document.getElementById('session-list-view');
    $detailView = document.getElementById('session-detail-view');
    $sessionList = document.getElementById('session-list');
    $agentSidebar = document.getElementById('agent-sidebar');
    $messageFeed = document.getElementById('message-feed');
    $detailTitle = document.getElementById('detail-title');
    $detailStatus = document.getElementById('detail-status');
    $detailMeta = document.getElementById('detail-meta');
    $turnInfo = document.getElementById('turn-info');
    $stats = document.getElementById('stats');
    $sseBadge = document.getElementById('sse-status');

    loadSessions();
    connectGlobalSSE();

    // Auto-refresh every 10s when on list view
    setInterval(() => {
      if (!currentSessionId) loadSessions();
    }, 10_000);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Don't intercept when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'Escape':
          if (currentSessionId) { back(); e.preventDefault(); }
          break;
        case 'r':
          if (!e.ctrlKey && !e.metaKey) { refresh(); e.preventDefault(); }
          break;
        case 'j': // Next session (vim-style)
        case 'k': // Prev session (vim-style)
          if (!currentSessionId && sessions.length > 0) {
            const rows = document.querySelectorAll('.session-card');
            const focused = document.querySelector('.session-card.focused');
            let idx = focused ? [...rows].indexOf(focused) : -1;
            if (e.key === 'j') idx = Math.min(idx + 1, rows.length - 1);
            else idx = Math.max(idx - 1, 0);
            rows.forEach((r) => r.classList.remove('focused'));
            rows[idx]?.classList.add('focused');
            rows[idx]?.scrollIntoView({ block: 'nearest' });
            e.preventDefault();
          }
          break;
        case 'Enter':
          if (!currentSessionId) {
            const focused = document.querySelector('.session-card.focused');
            if (focused) { viewSession(focused.dataset.id); e.preventDefault(); }
          }
          break;
      }
    });
  }

  // ---- Views --------------------------------------------------------------

  function showListView() {
    $listView.classList.add('active');
    $detailView.classList.remove('active');
    currentSessionId = null;
    currentSession = null;
    agentFilter = null;
    disconnectSessionSSE();
    stopStatusPoll();
  }

  function showDetailView() {
    $listView.classList.remove('active');
    $detailView.classList.add('active');
  }

  // ---- Data loading -------------------------------------------------------

  async function loadSessions() {
    try {
      const res = await fetch('/api/sessions');
      sessions = await res.json();
      SessionList.render(sessions, $sessionList);
      loadStats();
    } catch (err) {
      console.error('Failed to load sessions:', err);
      $sessionList.innerHTML = `<div class="empty-state" style="color: var(--red)">Failed to load sessions: ${err.message}</div>`;
    }
  }

  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      $stats.innerHTML = `
        <span class="stat"><span class="stat-value">${data.totalSessions}</span> sessions</span>
        <span class="stat"><span class="stat-value">${data.active}</span> active</span>
        <span class="stat"><span class="stat-value">${data.totalMessages}</span> messages</span>
      `;
    } catch { /* ignore */ }
  }

  async function viewSession(id) {
    currentSessionId = id;
    showDetailView();
    AgentCard.resetColors();

    try {
      const res = await fetch(`/api/sessions/${id}`);
      currentSession = await res.json();

      // Header
      $detailTitle.textContent = `Session ${currentSession.id}`;
      $detailStatus.className = `status-pill ${currentSession.status}`;
      $detailStatus.textContent = currentSession.status;

      const agents = (currentSession.agents || []).map((a) => `${a.name}(${a.backend})`).join(', ');
      $detailMeta.textContent = agents;

      // Agent cards
      AgentCard.render(currentSession.agents, $agentSidebar);

      // Turn info
      MessageFeed.renderTurnInfo($turnInfo, currentSession);

      // Transcript
      MessageFeed.render(currentSession.transcript || [], $messageFeed, currentSession);

      // If session is active, connect SSE for live updates + poll for status changes
      if (currentSession.status === 'active') {
        connectSessionSSE(id);
        startStatusPoll(id);
      } else {
        stopStatusPoll();
      }
    } catch (err) {
      console.error('Failed to load session:', err);
      $messageFeed.innerHTML = `<div class="empty-state" style="color: var(--red)">Failed to load: ${err.message}</div>`;
    }
  }

  // ---- SSE ----------------------------------------------------------------

  function connectGlobalSSE() {
    if (eventSource) return;

    eventSource = new EventSource('/api/events');

    eventSource.onopen = () => {
      $sseBadge.className = 'sse-badge connected';
      $sseBadge.textContent = 'live';
    };

    eventSource.onerror = () => {
      $sseBadge.className = 'sse-badge disconnected';
      $sseBadge.textContent = 'disconnected';

      // Reconnect after 3s
      setTimeout(() => {
        if (eventSource?.readyState === EventSource.CLOSED) {
          eventSource = null;
          connectGlobalSSE();
        }
      }, 3000);
    };

    // Session-level events
    eventSource.addEventListener('session_start', (e) => {
      const data = JSON.parse(e.data);
      // Refresh session list
      if (!currentSessionId) loadSessions();
      // Auto-navigate to new session
      if (!currentSessionId) {
        viewSession(data.sessionId);
      }
    });

    eventSource.addEventListener('session_end', (e) => {
      const data = JSON.parse(e.data);
      if (currentSessionId === data.sessionId && currentSession) {
        currentSession.status = data.reason === 'error' ? 'failed' : 'completed';
        $detailStatus.className = `status-pill ${currentSession.status}`;
        $detailStatus.textContent = currentSession.status;
        MessageFeed.renderTurnInfo($turnInfo, currentSession);
      }
      // Refresh list
      loadSessions();
    });

    eventSource.addEventListener('message', (e) => {
      const data = JSON.parse(e.data);
      if (currentSessionId === data.sessionId) {
        liveTurn = MessageFeed.appendMessage($messageFeed, data, liveTurn);
      }
    });

    eventSource.addEventListener('agent_status', (e) => {
      const data = JSON.parse(e.data);
      if (currentSessionId === data.sessionId) {
        AgentCard.updateStatus($agentSidebar, data.agent, data.status);
      }
    });

    eventSource.addEventListener('turn_complete', (e) => {
      const data = JSON.parse(e.data);
      if (currentSessionId === data.sessionId && currentSession) {
        currentSession.turn = data.turn;
        MessageFeed.renderTurnInfo($turnInfo, currentSession);
      }
    });

    eventSource.addEventListener('guardrail', (e) => {
      const data = JSON.parse(e.data);
      if (currentSessionId === data.sessionId) {
        MessageFeed.appendGuardrail($messageFeed, data.guard, data.detail);
      }
    });

    eventSource.addEventListener('error', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (currentSessionId === data.sessionId) {
          MessageFeed.appendGuardrail($messageFeed, 'error', data.error);
          if (data.agent) {
            AgentCard.updateStatus($agentSidebar, data.agent, 'dead');
          }
        }
      } catch { /* SSE connection error, not a data event */ }
    });
  }

  function connectSessionSSE(sessionId) {
    // Already connected globally — events are filtered by sessionId in handlers
    liveTurn = currentSession?.turn ?? -1;
  }

  function disconnectSessionSSE() {
    liveTurn = -1;
  }

  // ---- Status polling (fallback for missed SSE events) --------------------

  function startStatusPoll(sessionId) {
    stopStatusPoll();
    statusPollTimer = setInterval(async () => {
      if (currentSessionId !== sessionId) { stopStatusPoll(); return; }
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const data = await res.json();
        if (data.status !== 'active' && currentSession) {
          currentSession.status = data.status;
          currentSession.endedAt = data.endedAt;
          currentSession.turn = data.turn ?? currentSession.turn;
          $detailStatus.className = `status-pill ${data.status}`;
          $detailStatus.textContent = data.status;
          MessageFeed.renderTurnInfo($turnInfo, currentSession);
          stopStatusPoll();
          loadSessions(); // refresh list stats
        }
      } catch { /* ignore poll errors */ }
    }, 5000);
  }

  function stopStatusPoll() {
    if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
  }

  // ---- Agent filter (click sidebar to filter by agent) -------------------

  function filterByAgent(agentName) {
    if (agentFilter === agentName) {
      agentFilter = null; // toggle off
    } else {
      agentFilter = agentName;
    }
    // Update sidebar selection
    $agentSidebar.querySelectorAll('.agent-card').forEach((card) => {
      card.classList.toggle('selected', card.dataset.agent === agentFilter);
    });
    applyFilters();
  }

  // ---- Filters ------------------------------------------------------------

  function toggleFilter(type) {
    filters[type] = !filters[type];
    // Update button state
    const btn = document.querySelector(`.filter-btn[data-filter="${type}"]`);
    if (btn) btn.classList.toggle('active', filters[type]);
    // Update "All" button
    const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
    const allActive = filters.routed && filters.notes && filters.initial;
    if (allBtn) allBtn.classList.toggle('active', allActive);
    applyFilters();
  }

  function setFilter(preset) {
    if (preset === 'all') {
      filters.routed = true;
      filters.notes = true;
      filters.initial = true;
    }
    // Update all button states
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      const f = btn.dataset.filter;
      if (f === 'all') btn.classList.toggle('active', filters.routed && filters.notes && filters.initial);
      else btn.classList.toggle('active', filters[f]);
    });
    applyFilters();
  }

  function applyFilters() {
    if (!$messageFeed) return;
    const messages = $messageFeed.querySelectorAll('.message');
    messages.forEach((el) => {
      const type = el.dataset.msgType;
      const from = el.dataset.msgFrom;
      const to = el.dataset.msgTo;

      // Type filter
      const typeHidden = type && filters[type] === false;
      // Agent filter — show if agent is sender or recipient
      const agentHidden = agentFilter && from !== agentFilter && to !== agentFilter;

      if (typeHidden || agentHidden) {
        el.classList.add('filter-hidden');
      } else {
        el.classList.remove('filter-hidden');
      }
    });
    // Show/hide reasoning toggles based on notes filter
    $messageFeed.querySelectorAll('.reasoning-toggle').forEach((el) => {
      el.style.display = filters.notes ? '' : 'none';
    });
    // Collapse reasoning when notes are filtered out
    if (!filters.notes) {
      $messageFeed.querySelectorAll('.message.show-reasoning').forEach((el) => {
        el.classList.remove('show-reasoning');
      });
    }
    // Hide turn separators that have no visible messages after them
    $messageFeed.querySelectorAll('.turn-separator').forEach((sep) => {
      let next = sep.nextElementSibling;
      let hasVisible = false;
      while (next && !next.classList.contains('turn-separator')) {
        if (next.classList.contains('message') && !next.classList.contains('filter-hidden')) {
          hasVisible = true;
          break;
        }
        next = next.nextElementSibling;
      }
      sep.style.display = hasVisible ? '' : 'none';
    });
  }

  // ---- Public API ---------------------------------------------------------

  function back() {
    showListView();
    loadSessions();
  }

  function refresh() {
    if (currentSessionId) {
      viewSession(currentSessionId);
    } else {
      loadSessions();
    }
  }

  async function deleteSession(id, event) {
    if (event) event.stopPropagation();
    if (!confirm(`Delete session ${id}?`)) return;

    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (currentSessionId === id) back();
      else loadSessions();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);

  return { viewSession, back, refresh, deleteSession, toggleFilter, setFilter, filterByAgent };
})();
