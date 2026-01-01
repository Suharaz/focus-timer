/**
 * Focus Timer - Popup Script
 * Displays gamified stats dashboard with real-time updates
 */

let updateInterval = null;
let cachedData = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadAndRender();
  setupEventListeners();
  startRealTimeUpdates();
}

async function loadAndRender() {
  const [localData, syncData] = await Promise.all([
    chrome.storage.local.get('domains'),
    chrome.storage.sync.get(['settings', 'streaks'])
  ]);
  cachedData = { ...localData, ...syncData };
  renderStreak(cachedData.streaks);
  renderDomains(cachedData.domains, cachedData.settings);
}

function startRealTimeUpdates() {
  updateInterval = setInterval(async () => {
    try {
      const [localData, syncData] = await Promise.all([
        chrome.storage.local.get('domains'),
        chrome.storage.sync.get('settings')
      ]);

      let trackingState = null;
      try {
        trackingState = await chrome.runtime.sendMessage({ type: 'getTrackingState' });
      } catch (e) {}

      const domains = { ...localData.domains };
      const settings = syncData.settings || {};
      const today = new Date().toDateString();

      if (trackingState && trackingState.currentDomain) {
        const domain = trackingState.currentDomain;
        if (!domains[domain]) {
          domains[domain] = { today: 0, total: 0, todayDate: today };
        }
        if (domains[domain].todayDate === today) {
          domains[domain] = {
            ...domains[domain],
            today: domains[domain].today + trackingState.currentSeconds
          };
        }
      }

      if (trackingState && trackingState.pendingTime) {
        for (const [domain, ms] of Object.entries(trackingState.pendingTime)) {
          if (!domains[domain]) {
            domains[domain] = { today: 0, total: 0, todayDate: today };
          }
          if (domains[domain].todayDate === today) {
            domains[domain] = {
              ...domains[domain],
              today: domains[domain].today + Math.floor(ms / 1000)
            };
          }
        }
      }

      cachedData.domains = domains;
      cachedData.settings = settings;
      renderDomains(domains, settings);
    } catch (e) {}
  }, 1000);
}

window.addEventListener('unload', () => {
  if (updateInterval) clearInterval(updateInterval);
});

function renderStreak(streaks) {
  const streakEl = document.getElementById('streak');
  const countEl = streakEl.querySelector('.streak-count');
  const fireEl = streakEl.querySelector('.streak-fire');
  const labelEl = streakEl.querySelector('.streak-label');

  const current = streaks?.current || 0;
  countEl.textContent = current;

  const fires = Math.min(Math.floor(current / 3) + 1, 5);
  fireEl.textContent = '🔥'.repeat(fires);

  labelEl.textContent = current === 1 ? 'day' : 'days';
  streakEl.title = 'Best: ' + (streaks?.best || 0) + ' days';
}

function renderDomains(domains, settings) {
  const container = document.getElementById('domains');
  const totalTimeEl = document.getElementById('total-time');

  if (!domains || Object.keys(domains).length === 0) {
    container.innerHTML = '<div class="empty">Start browsing to track time!</div>';
    totalTimeEl.textContent = '0:00';
    return;
  }

  const today = new Date().toDateString();
  const sorted = Object.entries(domains)
    .filter(([_, d]) => d.today > 0 && d.todayDate === today)
    .sort((a, b) => b[1].today - a[1].today)
    .slice(0, 5);

  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">No activity today yet!</div>';
    totalTimeEl.textContent = '0:00';
    return;
  }

  const limits = settings?.limits || {};
  let totalSeconds = 0;

  container.innerHTML = sorted.map(([domain, data]) => {
    const seconds = data.today;
    totalSeconds += seconds;
    const limit = limits[domain];
    return createDomainCard(domain, seconds, limit);
  }).join('');

  totalTimeEl.textContent = formatTimeWithSeconds(totalSeconds);
}

function createDomainCard(domain, seconds, limitMinutes) {
  const timeStr = formatTimeWithSeconds(seconds);

  if (!limitMinutes) {
    return `
      <div class="domain-card">
        <div class="domain-header">
          <span class="domain-name">${escapeHtml(domain)}</span>
          <span class="domain-time">${timeStr}</span>
        </div>
        <div class="domain-nolimit">no limit set</div>
      </div>
    `;
  }

  const limitSeconds = limitMinutes * 60;
  const percent = Math.min((seconds / limitSeconds) * 100, 100);
  const status = percent >= 100 ? 'over' : percent >= 75 ? 'warning' : 'ok';

  return `
    <div class="domain-card">
      <div class="domain-header">
        <span class="domain-name">${escapeHtml(domain)}</span>
        <span class="domain-time">${timeStr} / ${limitMinutes}m</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${status}" style="width: ${percent}%"></div>
      </div>
      <div class="domain-percent">${Math.round(percent)}%</div>
    </div>
  `;
}

function formatTimeWithSeconds(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n) => n.toString().padStart(2, '0');
  if (hours > 0) return hours + ':' + pad(mins) + ':' + pad(secs);
  return mins + ':' + pad(secs);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setupEventListeners() {
  document.getElementById('home-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}
