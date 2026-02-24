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
            const rows = document.querySelectorAll('.session-row');
            const focused = document.querySelector('.session-row.focused');
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
            const focused = document.querySelector('.session-row.focused');
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
    disconnectSessionSSE();
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

      // If session is active, connect SSE for live updates
      if (currentSession.status === 'active') {
        connectSessionSSE(id);
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

  return { viewSession, back, refresh, deleteSession };
})();
