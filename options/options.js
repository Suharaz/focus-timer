/**
 * Focus Timer - Combined Dashboard & Settings
 */

// Storage abstraction - sync for small data, local for large data
const Storage = {
  async get(keys) {
    const syncKeys = ['settings', 'reminders', 'streaks'];
    const localKeys = ['domains', 'history', 'habitTracker'];
    const keyList = Array.isArray(keys) ? keys : [keys];
    const result = {};

    const syncNeeded = keyList.filter(k => syncKeys.includes(k));
    const localNeeded = keyList.filter(k => localKeys.includes(k));

    if (syncNeeded.length > 0) {
      Object.assign(result, await chrome.storage.sync.get(syncNeeded));
    }
    if (localNeeded.length > 0) {
      Object.assign(result, await chrome.storage.local.get(localNeeded));
    }
    return result;
  },
  async set(data) {
    const syncKeys = ['settings', 'reminders', 'streaks'];
    const syncData = {}, localData = {};

    for (const [key, value] of Object.entries(data)) {
      if (syncKeys.includes(key)) syncData[key] = value;
      else localData[key] = value;
    }

    if (Object.keys(syncData).length > 0) await chrome.storage.sync.set(syncData);
    if (Object.keys(localData).length > 0) await chrome.storage.local.set(localData);
  },
  async clear() {
    await Promise.all([chrome.storage.sync.clear(), chrome.storage.local.clear()]);
  }
};

// ============ GLOBALS ============
const MAX_VISIBLE_LIMITS = 3;
let limitsExpanded = false;
let selectedIcon = '💧';

// Dashboard globals
let dailyChart = null;
let domainsChart = null;
let currentPeriod = 'week';

const COLORS = [
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4'
];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupTabs();
  await loadDashboard();
  await loadHabits();
  await loadSettingsStats();
  await loadSettings();
  await loadReminders();
  setupEventListeners();
  setupReminderListeners();
  setupSyncListeners();
  await updateSyncStatus();
}

// ============ TABS ============
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;

      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${tabId}`).classList.add('active');

      // Reload dashboard when switching to it
      if (tabId === 'dashboard') {
        loadDashboard();
      } else if (tabId === 'habits') {
        loadHabits();
      }
    });
  });

  // Period selector
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      loadDashboard();
    });
  });
}

// ============ DASHBOARD ============
async function loadDashboard() {
  // Save today to history first
  await saveTodayToHistory();
  const stats = await getDataForPeriod(currentPeriod);

  // Update summary cards
  document.getElementById('total-time').textContent = formatTime(stats.totalSeconds);
  document.getElementById('avg-daily').textContent = formatTime(stats.avgDaily);
  document.getElementById('streak-count').textContent = stats.streak;
  document.getElementById('domains-count').textContent = stats.domainsCount;

  // Update charts
  updateDailyChart(stats.labels, stats.dailyTotals);
  updateDomainsChart(stats.domainTotals);
  updateDomainsList(stats.domainTotals, stats.domainVisits);
}

async function getDataForPeriod(period) {
  const { start, end } = getDateRange(period);
  const data = await Storage.get(['history', 'domains', 'streaks']);
  const history = data.history || {};
  const domains = data.domains || {};
  const streaks = data.streaks || { current: 0 };

  // Get today's data
  const todayKey = new Date().toISOString().split('T')[0];
  const todayStr = new Date().toDateString();
  const todayData = {};
  const todayVisits = {};

  for (const [domain, info] of Object.entries(domains)) {
    if (info.todayDate === todayStr && info.today > 0) {
      todayData[domain] = info.today;
      todayVisits[domain] = info.visitsToday || 0;
    }
  }

  // Merge today's data into history
  const fullHistory = { ...history };
  if (Object.keys(todayData).length > 0) {
    fullHistory[todayKey] = { time: todayData, visits: todayVisits };
  }

  // Process data
  const dailyTotals = [];
  const domainTotals = {};
  const domainVisits = {};
  const labels = [];
  let totalSeconds = 0;
  let daysWithData = 0;

  const current = new Date(start);
  while (current <= end) {
    const dateKey = current.toISOString().split('T')[0];
    const month = current.getMonth() + 1;
    const day = current.getDate();
    labels.push(`${month}/${day}`);

    const dayData = fullHistory[dateKey];
    let dayTotal = 0;

    if (dayData) {
      // Handle both old format (object) and new format ({ time, visits })
      const timeData = dayData.time || dayData;
      const visitData = dayData.visits || {};

      for (const [domain, seconds] of Object.entries(timeData)) {
        if (typeof seconds === 'number') {
          dayTotal += seconds;
          domainTotals[domain] = (domainTotals[domain] || 0) + seconds;
          domainVisits[domain] = (domainVisits[domain] || 0) + (visitData[domain] || 0);
        }
      }
    }

    dailyTotals.push(dayTotal);
    totalSeconds += dayTotal;
    if (dayTotal > 0) daysWithData++;

    current.setDate(current.getDate() + 1);
  }

  return {
    labels,
    dailyTotals,
    domainTotals,
    domainVisits,
    totalSeconds,
    avgDaily: daysWithData > 0 ? Math.round(totalSeconds / daysWithData) : 0,
    domainsCount: Object.keys(domainTotals).length,
    streak: streaks.current
  };
}

function getDateRange(period) {
  const end = new Date();
  const start = new Date();

  switch (period) {
    case 'week': start.setDate(start.getDate() - 6); break;
    case 'month': start.setDate(start.getDate() - 29); break;
    case 'all': start.setFullYear(start.getFullYear() - 1); break;
  }

  return { start, end };
}

function updateDailyChart(labels, data) {
  const ctx = document.getElementById('daily-chart').getContext('2d');

  if (dailyChart) dailyChart.destroy();

  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Time (minutes)',
        data: data.map(s => Math.round(s / 60)),
        backgroundColor: 'rgba(139, 92, 246, 0.6)',
        borderColor: '#8b5cf6',
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a1a',
          callbacks: { label: (ctx) => formatTime(ctx.raw * 60) }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#737373', maxRotation: 45 } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#737373', callback: (v) => `${v}m` } }
      }
    }
  });
}

function updateDomainsChart(domainTotals) {
  const ctx = document.getElementById('domains-chart').getContext('2d');

  if (domainsChart) domainsChart.destroy();

  const sorted = Object.entries(domainTotals).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (sorted.length === 0) return;

  domainsChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([d]) => d),
      datasets: [{
        data: sorted.map(([, s]) => Math.round(s / 60)),
        backgroundColor: COLORS.slice(0, sorted.length),
        borderColor: '#0f0f0f',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#737373', padding: 8, usePointStyle: true } },
        tooltip: { callbacks: { label: (ctx) => ` ${formatTime(ctx.raw * 60)}` } }
      }
    }
  });
}

function updateDomainsList(domainTotals, domainVisits) {
  const container = document.getElementById('domain-details');
  const sorted = Object.entries(domainTotals).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty-state">No data yet. Start browsing!</div>';
    return;
  }

  const maxSeconds = sorted[0][1];

  container.innerHTML = sorted.map(([domain, seconds], i) => {
    const percent = (seconds / maxSeconds) * 100;
    const visits = domainVisits[domain] || 0;
    const visitsText = visits > 0 ? `<span class="domain-visits">${visits} visits</span>` : '';

    return `
      <div class="domain-row">
        <div class="domain-info">
          <div class="domain-name">${escapeHtml(domain)}</div>
          <div class="domain-bar">
            <div class="domain-bar-fill" style="width: ${percent}%; background: ${COLORS[i % COLORS.length]}"></div>
          </div>
        </div>
        <div class="domain-time">${formatTime(seconds)}${visitsText}</div>
      </div>
    `;
  }).join('');
}

// ============ SETTINGS TAB ============
async function loadSettingsStats() {
  const data = await Storage.get(['domains', 'streaks']);
  const domains = data.domains || {};
  const streaks = data.streaks || { current: 0 };

  const today = new Date().toDateString();
  let totalToday = 0;
  let trackedCount = 0;

  for (const [domain, info] of Object.entries(domains)) {
    trackedCount++;
    if (info.todayDate === today) {
      totalToday += info.today || 0;
    }
  }

  document.getElementById('stat-streak').textContent = streaks.current;
  document.getElementById('stat-today').textContent = formatTime(totalToday);
  document.getElementById('stat-domains').textContent = trackedCount;
}

async function loadSettings() {
  const data = await Storage.get(['domains', 'settings']);
  const settings = data.settings || { limits: {}, trackingEnabled: true };

  document.getElementById('tracking-enabled').checked = settings.trackingEnabled;
  renderLimits(settings.limits);
}

function renderLimits(limits) {
  const container = document.getElementById('limits-list');
  const expandBtn = document.getElementById('expand-limits-btn');
  const entries = Object.entries(limits).sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state">No limits set yet</div>';
    expandBtn.style.display = 'none';
    return;
  }

  const visibleEntries = limitsExpanded ? entries : entries.slice(0, MAX_VISIBLE_LIMITS);
  const hasMore = entries.length > MAX_VISIBLE_LIMITS;

  container.innerHTML = visibleEntries.map(([domain, mins]) => `
    <div class="limit-chip" data-domain="${escapeHtml(domain)}">
      <span class="domain">${escapeHtml(domain)}</span>
      <span class="time">${mins}m</span>
      <button class="delete-btn" data-domain="${escapeHtml(domain)}">×</button>
    </div>
  `).join('');

  expandBtn.style.display = hasMore && !limitsExpanded ? 'inline-block' : 'none';
  if (hasMore) document.getElementById('limits-count').textContent = `(${entries.length})`;
}

async function loadReminders() {
  const data = await Storage.get(['reminders', 'habitTracker']);
  const reminders = data.reminders || [];
  const habitTracker = data.habitTracker || {};
  renderReminders(reminders, habitTracker);
}

function generateHabitBoard(reminderId, habitData) {
  const days = [];
  const today = new Date();

  for (let i = 13; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const status = habitData[dateStr] || 'none';
    days.push({ date: dateStr, status, dayNum: date.getDate() });
  }

  return `<div class="habit-board">${days.map(day =>
    `<div class="habit-cell habit-${day.status}" data-reminder="${reminderId}" data-date="${day.date}" title="Day ${day.dayNum}"></div>`
  ).join('')}</div>`;
}

function renderReminders(reminders, habitTracker) {
  const container = document.getElementById('reminder-list');

  if (reminders.length === 0) {
    container.innerHTML = '<div class="empty-state">No reminders</div>';
    return;
  }

  container.innerHTML = reminders.map(reminder => {
    const scheduleText = reminder.type === 'interval' ? `Every ${reminder.interval} min` : `Daily at ${reminder.time}`;
    const icon = reminder.icon || '⏰';
    const habitBoard = generateHabitBoard(reminder.id, habitTracker[reminder.id] || {});

    return `
      <div class="reminder-chip" data-id="${reminder.id}">
        <div class="reminder-main">
          <div class="reminder-info">
            <label class="reminder-toggle">
              <input type="checkbox" class="toggle-reminder" data-id="${reminder.id}" ${reminder.enabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
            <span class="reminder-icon">${icon}</span>
            <div class="reminder-text">
              <span class="reminder-title">${escapeHtml(reminder.title)}</span>
              <span class="reminder-schedule">${scheduleText}</span>
            </div>
          </div>
          <button class="reminder-delete" data-id="${reminder.id}">×</button>
        </div>
        ${habitBoard}
      </div>
    `;
  }).join('');
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
  // Tracking toggle
  document.getElementById('tracking-enabled').addEventListener('change', async (e) => {
    const data = await Storage.get('settings');
    const settings = data.settings || { limits: {}, trackingEnabled: true };
    settings.trackingEnabled = e.target.checked;
    await Storage.set({ settings });
    showToast(e.target.checked ? 'Tracking enabled' : 'Tracking paused');
  });

  // Add limit
  document.getElementById('add-btn').addEventListener('click', addLimit);
  document.getElementById('new-limit').addEventListener('keypress', (e) => { if (e.key === 'Enter') addLimit(); });
  document.getElementById('new-domain').addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('new-limit').focus(); });

  // Delete limit
  document.getElementById('limits-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.delete-btn');
    if (!btn) return;

    const domain = btn.dataset.domain;
    const data = await Storage.get('settings');
    const settings = data.settings || { limits: {} };
    delete settings.limits[domain];
    await Storage.set({ settings });
    await loadSettings();
    showToast('Limit removed');
  });

  // Expand limits
  document.getElementById('expand-limits-btn').addEventListener('click', () => {
    limitsExpanded = true;
    loadSettings();
  });

  // Reset data
  document.getElementById('reset-btn').addEventListener('click', async () => {
    if (!confirm('Delete ALL data?')) return;
    if (!confirm('This cannot be undone. Continue?')) return;

    await Storage.clear();
    await Storage.set({
      domains: {},
      settings: { limits: {}, trackingEnabled: true },
      streaks: { current: 0, best: 0, lastDate: null },
      reminders: []
    });

    await loadDashboard();
  await loadHabits();
    await loadSettingsStats();
    await loadSettings();
    await loadReminders();
    showToast('All data reset');
  });
}

async function addLimit() {
  const domainInput = document.getElementById('new-domain');
  const limitInput = document.getElementById('new-limit');

  let domain = domainInput.value.trim().toLowerCase();
  const limit = parseInt(limitInput.value);

  if (!domain) { showToast('Enter a domain', 'error'); return; }

  try {
    if (!domain.includes('://')) domain = 'https://' + domain;
    domain = new URL(domain).hostname;
  } catch { showToast('Invalid domain', 'error'); return; }

  if (!limit || limit < 1) { showToast('Enter valid limit', 'error'); return; }

  const data = await Storage.get('settings');
  const settings = data.settings || { limits: {} };
  settings.limits[domain] = limit;

  await Storage.set({ settings });
  await loadSettings();

  domainInput.value = '';
  limitInput.value = '';
  showToast(`${domain} limited to ${limit}m`);
}

// ============ REMINDERS ============
function setupReminderListeners() {
  const iconBtn = document.getElementById('icon-picker-btn');
  const iconDropdown = document.getElementById('icon-picker-dropdown');

  iconBtn.addEventListener('click', (e) => { e.stopPropagation(); iconDropdown.classList.toggle('show'); });

  document.querySelectorAll('.icon-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedIcon = btn.dataset.icon;
      iconBtn.textContent = selectedIcon;
      iconDropdown.classList.remove('show');
    });
  });

  document.addEventListener('click', () => iconDropdown.classList.remove('show'));

  document.getElementById('reminder-type').addEventListener('change', (e) => {
    document.getElementById('interval-input').style.display = e.target.value === 'interval' ? 'flex' : 'none';
    document.getElementById('daily-input').style.display = e.target.value === 'daily' ? 'flex' : 'none';
  });

  document.getElementById('add-reminder-btn').addEventListener('click', addReminder);

  document.getElementById('reminder-list').addEventListener('change', async (e) => {
    if (!e.target.classList.contains('toggle-reminder')) return;

    const id = e.target.dataset.id;
    const enabled = e.target.checked;

    const data = await Storage.get('reminders');
    const reminders = data.reminders || [];
    const reminder = reminders.find(r => r.id === id);

    if (reminder) {
      reminder.enabled = enabled;
      await Storage.set({ reminders });
      chrome.runtime.sendMessage({ type: 'refreshReminders' }).catch(() => {});
      showToast(enabled ? 'Reminder on' : 'Reminder off');
    }
  });

  document.getElementById('reminder-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.reminder-delete');
    if (btn) {
      const id = btn.dataset.id;
      const data = await Storage.get('reminders');
      let reminders = data.reminders || [];
      reminders = reminders.filter(r => r.id !== id);

      await Storage.set({ reminders });
      await loadReminders();
      chrome.runtime.sendMessage({ type: 'refreshReminders' }).catch(() => {});
      showToast('Reminder removed');
      return;
    }

    const cell = e.target.closest('.habit-cell');
    if (cell) {
      await cycleHabitStatus(cell.dataset.reminder, cell.dataset.date);
    }
  });
}

async function cycleHabitStatus(reminderId, date) {
  const statusOrder = ['none', 'done', 'partial', 'skipped'];
  const data = await Storage.get('habitTracker');
  const habitTracker = data.habitTracker || {};

  if (!habitTracker[reminderId]) habitTracker[reminderId] = {};

  const currentStatus = habitTracker[reminderId][date] || 'none';
  const nextStatus = statusOrder[(statusOrder.indexOf(currentStatus) + 1) % statusOrder.length];

  if (nextStatus === 'none') delete habitTracker[reminderId][date];
  else habitTracker[reminderId][date] = nextStatus;

  await Storage.set({ habitTracker });
  await loadReminders();

  const names = { done: '✓ Done', partial: '◐ Partial', skipped: '✗ Skipped', none: '○ Empty' };
  showToast(names[nextStatus]);
}

async function addReminder() {
  const type = document.getElementById('reminder-type').value;
  const title = document.getElementById('reminder-title').value.trim();
  const actionsInput = document.getElementById('reminder-actions').value.trim();

  if (!title) { showToast('Enter a title', 'error'); return; }

  const actions = actionsInput ? actionsInput.split(',').map(a => a.trim()).filter(a => a) : ['Got it!'];

  const reminder = {
    id: Date.now().toString(),
    type, title, message: title, icon: selectedIcon, actions, enabled: true
  };

  if (type === 'interval') {
    const interval = parseInt(document.getElementById('reminder-interval').value);
    if (!interval || interval < 1) { showToast('Enter valid interval', 'error'); return; }
    reminder.interval = interval;
  } else {
    reminder.time = document.getElementById('reminder-time').value || '09:00';
  }

  const data = await Storage.get('reminders');
  const reminders = data.reminders || [];
  reminders.push(reminder);

  await Storage.set({ reminders });
  await loadReminders();

  document.getElementById('reminder-title').value = '';
  document.getElementById('reminder-interval').value = '';
  document.getElementById('reminder-actions').value = '';
  selectedIcon = '💧';
  document.getElementById('icon-picker-btn').textContent = '💧';

  chrome.runtime.sendMessage({ type: 'refreshReminders' }).catch(() => {});
  showToast('Reminder added');
}

// ============ GOOGLE DRIVE SYNC ============
async function updateSyncStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'driveStatus' });

    const syncIcon = document.getElementById('sync-icon');
    const syncState = document.getElementById('sync-state');
    const syncDetail = document.getElementById('sync-detail');
    const connectBtn = document.getElementById('connect-btn');
    const backupBtn = document.getElementById('backup-btn');
    const restoreBtn = document.getElementById('restore-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');

    if (status.connected) {
      syncIcon.textContent = '✅';
      syncState.textContent = 'Connected';
      syncState.classList.add('connected');

      let detail = status.lastSync
        ? `Last: ${formatDateTime(status.lastSync)}`
        : status.backupExists ? `Backup: ${formatDateTime(status.backupTime)}` : 'Ready to backup';
      syncDetail.textContent = detail;

      connectBtn.style.display = 'none';
      backupBtn.style.display = 'inline-block';
      restoreBtn.style.display = status.backupExists ? 'inline-block' : 'none';
      disconnectBtn.style.display = 'inline-block';
    } else {
      syncIcon.textContent = '☁️';
      syncState.textContent = 'Google Drive';
      syncState.classList.remove('connected');
      syncDetail.textContent = 'Not connected';

      connectBtn.style.display = 'inline-block';
      backupBtn.style.display = 'none';
      restoreBtn.style.display = 'none';
      disconnectBtn.style.display = 'none';
    }
  } catch (e) { console.log('Sync status error:', e); }
}

function setupSyncListeners() {
  document.getElementById('connect-btn').addEventListener('click', async () => {
    const btn = document.getElementById('connect-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const result = await chrome.runtime.sendMessage({ type: 'driveConnect' });
      showToast(result.success ? 'Connected!' : 'Connection failed', result.success ? 'success' : 'error');
      await updateSyncStatus();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }

    btn.classList.remove('loading');
    btn.disabled = false;
  });

  document.getElementById('backup-btn').addEventListener('click', async () => {
    const btn = document.getElementById('backup-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const result = await chrome.runtime.sendMessage({ type: 'driveBackup' });
      showToast(result.success ? 'Backup done!' : 'Backup failed', result.success ? 'success' : 'error');
      await updateSyncStatus();
    } catch (e) { showToast('Error', 'error'); }

    btn.classList.remove('loading');
    btn.disabled = false;
  });

  document.getElementById('restore-btn').addEventListener('click', async () => {
    if (!confirm('Overwrite current data with backup?')) return;

    const btn = document.getElementById('restore-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const result = await chrome.runtime.sendMessage({ type: 'driveRestore' });
      if (result.success) {
        showToast('Restored!');
        await loadDashboard();
  await loadHabits();
        await loadSettingsStats();
        await loadSettings();
        await loadReminders();
        await updateSyncStatus();
      } else { showToast('Restore failed', 'error'); }
    } catch (e) { showToast('Error', 'error'); }

    btn.classList.remove('loading');
    btn.disabled = false;
  });

  document.getElementById('disconnect-btn').addEventListener('click', async () => {
    if (!confirm('Disconnect from Google Drive?')) return;

    try {
      await chrome.runtime.sendMessage({ type: 'driveDisconnect' });
      showToast('Disconnected');
      await updateSyncStatus();
    } catch (e) { showToast('Error', 'error'); }
  });
}

// ============ UTILITIES ============
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.className = 'toast'; }, 2000);
}
// ============ HABITS TAB ============
let habitPeriod = 'week';
let habitOffset = 0;

function setupHabitListeners() {
  document.querySelectorAll('.habit-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.habit-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      habitPeriod = btn.dataset.period;
      habitOffset = 0;
      renderHeatmap();
    });
  });

  const prevBtn = document.getElementById('habit-prev');
  const nextBtn = document.getElementById('habit-next');
  const closeBtn = document.getElementById('popup-close');
  const popup = document.getElementById('day-detail-popup');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      habitOffset--;
      renderHeatmap();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (habitOffset < 0) {
        habitOffset++;
        renderHeatmap();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      popup.style.display = 'none';
    });
  }

  if (popup) {
    popup.addEventListener('click', (e) => {
      if (e.target === popup) {
        popup.style.display = 'none';
      }
    });
  }
}

async function loadHabits() {
  setupHabitListeners();
  await renderHeatmap();
  await renderHabitSummary();
}

async function renderHeatmap() {
  const grid = document.getElementById('heatmap-grid');
  const titleEl = document.getElementById('heatmap-title');
  if (!grid) return;

  const data = await Storage.get('habitTracker');
  const habitData = data.habitTracker || {};

  const today = new Date();
  let days = [];
  let title = '';

  if (habitPeriod === 'week') {
    const startOfWeek = new Date(today);
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startOfWeek.setDate(today.getDate() - diff + (habitOffset * 7));
    startOfWeek.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      days.push(d);
    }

    if (habitOffset === 0) title = 'This Week';
    else if (habitOffset === -1) title = 'Last Week';
    else {
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      title = formatDateRange(startOfWeek, endOfWeek);
    }
  } else {
    const targetMonth = new Date(today.getFullYear(), today.getMonth() + habitOffset, 1);
    const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();

    for (let i = 1; i <= lastDay; i++) {
      days.push(new Date(targetMonth.getFullYear(), targetMonth.getMonth(), i));
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    title = monthNames[targetMonth.getMonth()] + ' ' + targetMonth.getFullYear();
  }

  titleEl.textContent = title;
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  grid.innerHTML = days.map(date => {
    const dateStr = date.toDateString();
    const dayHabits = habitData[dateStr] || {};
    const totalCount = Object.values(dayHabits).reduce((sum, h) => sum + (h.count || 0), 0);
    const isFuture = date > today;
    const isToday = date.toDateString() === today.toDateString();

    let sizeClass = '';
    if (totalCount >= 10) sizeClass = 'size-4';
    else if (totalCount >= 7) sizeClass = 'size-3';
    else if (totalCount >= 4) sizeClass = 'size-2';
    else if (totalCount >= 1) sizeClass = 'size-1';

    const dayIdx = date.getDay();
    const dayLabel = habitPeriod === 'week' ? dayNames[(dayIdx + 6) % 7] : '';

    let html = '<div class="heatmap-day';
    if (isFuture) html += ' future';
    if (isToday) html += ' today';
    html += '" data-date="' + dateStr + '"';
    if (!isFuture) html += ' onclick="showDayDetail(\'' + dateStr.replace(/'/g, "\\'") + '\')"';
    html += '>';
    if (dayLabel) html += '<span class="day-label">' + dayLabel + '</span>';
    html += '<span class="day-num">' + date.getDate() + '</span>';
    html += '<div class="habit-circle ' + sizeClass + '"></div>';
    html += '</div>';
    return html;
  }).join('');
}

function formatDateRange(start, end) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (start.getMonth() === end.getMonth()) {
    return months[start.getMonth()] + ' ' + start.getDate() + '-' + end.getDate();
  }
  return months[start.getMonth()] + ' ' + start.getDate() + ' - ' + months[end.getMonth()] + ' ' + end.getDate();
}

async function showDayDetail(dateStr) {
  const popup = document.getElementById('day-detail-popup');
  const dateEl = document.getElementById('popup-date');
  const contentEl = document.getElementById('popup-content');

  const data = await Storage.get('habitTracker');
  const habitData = data.habitTracker || {};
  const dayHabits = habitData[dateStr] || {};

  const date = new Date(dateStr);
  const options = { weekday: 'long', month: 'short', day: 'numeric' };
  dateEl.textContent = date.toLocaleDateString('en-US', options);

  const habits = Object.entries(dayHabits);
  if (habits.length === 0) {
    contentEl.innerHTML = '<div class="empty-state">No habits tracked this day</div>';
  } else {
    contentEl.innerHTML = habits.map(([name, hdata]) => {
      return '<div class="habit-item">' +
        '<span class="habit-icon">' + (hdata.icon || '🎯') + '</span>' +
        '<div class="habit-info">' +
        '<div class="habit-name">' + escapeHtml(name) + '</div>' +
        '<div class="habit-count">' + (hdata.count || 0) + ' times</div>' +
        '</div>' +
        '<span class="habit-badge">' + (hdata.count || 0) + '</span>' +
        '</div>';
    }).join('');
  }

  popup.style.display = 'block';
}

async function renderHabitSummary() {
  const container = document.getElementById('habit-summary');
  if (!container) return;

  const data = await Storage.get('habitTracker');
  const habitData = data.habitTracker || {};

  const habitTotals = {};

  for (const [dateStr, dayHabits] of Object.entries(habitData)) {
    for (const [name, hdata] of Object.entries(dayHabits)) {
      if (!habitTotals[name]) {
        habitTotals[name] = { icon: hdata.icon || '🎯', total: 0, days: 0 };
      }
      habitTotals[name].total += hdata.count || 0;
      habitTotals[name].days++;
    }
  }

  const sorted = Object.entries(habitTotals).sort((a, b) => b[1].total - a[1].total);

  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty-state">No habits tracked yet. Complete reminders to build your habit history!</div>';
    return;
  }

  container.innerHTML = sorted.map(([name, hdata]) => {
    return '<div class="habit-summary-item">' +
      '<span class="habit-summary-icon">' + hdata.icon + '</span>' +
      '<div class="habit-summary-info">' +
      '<div class="habit-summary-name">' + escapeHtml(name) + '</div>' +
      '<div class="habit-summary-stats">' + hdata.days + ' days tracked</div>' +
      '</div>' +
      '<span class="habit-summary-total">' + hdata.total + '</span>' +
      '</div>';
  }).join('');
}

// Save today's data to history (for immediate dashboard display)
async function saveTodayToHistory() {
  const data = await Storage.get(['domains', 'history']);
  const domains = data.domains || {};
  const history = data.history || {};

  const today = new Date();
  const dateKey = today.toISOString().split('T')[0];
  const todayStr = today.toDateString();

  const todayTime = {};
  const todayVisits = {};

  for (const [domain, info] of Object.entries(domains)) {
    if (info.todayDate === todayStr && info.today > 0) {
      todayTime[domain] = info.today;
      todayVisits[domain] = info.visitsToday || 0;
    }
  }

  if (Object.keys(todayTime).length > 0) {
    history[dateKey] = { time: todayTime, visits: todayVisits };
    await Storage.set({ history });
  }
}
