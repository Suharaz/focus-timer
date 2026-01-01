/**
 * Focus Timer - Service Worker
 * Tracks time spent on domains in active tabs
 * Handles reminders/notifications
 */

// Import Google Drive sync service
importScripts('../services/drive-sync.js');

// ============ Storage Abstraction ============
// sync: settings, reminders, streaks (small, need sync across devices)
// local: domains, history, habitTracker (large, unlimited storage)

const Storage = {
  // Get from appropriate storage
  async get(keys) {
    const syncKeys = ['settings', 'reminders', 'streaks'];
    const localKeys = ['domains', 'history', 'habitTracker', 'driveSync'];

    const keyList = Array.isArray(keys) ? keys : [keys];
    const result = {};

    const syncNeeded = keyList.filter(k => syncKeys.includes(k));
    const localNeeded = keyList.filter(k => localKeys.includes(k));

    if (syncNeeded.length > 0) {
      const syncData = await chrome.storage.sync.get(syncNeeded);
      Object.assign(result, syncData);
    }
    if (localNeeded.length > 0) {
      const localData = await chrome.storage.local.get(localNeeded);
      Object.assign(result, localData);
    }

    return result;
  },

  // Set to appropriate storage
  async set(data) {
    const syncKeys = ['settings', 'reminders', 'streaks'];

    const syncData = {};
    const localData = {};

    for (const [key, value] of Object.entries(data)) {
      if (syncKeys.includes(key)) {
        syncData[key] = value;
      } else {
        localData[key] = value;
      }
    }

    if (Object.keys(syncData).length > 0) {
      await chrome.storage.sync.set(syncData);
    }
    if (Object.keys(localData).length > 0) {
      await chrome.storage.local.set(localData);
      // Check storage size after local write
      checkStorageSize();
    }
  },

  // Get all data for backup
  async getAll() {
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get(null)
    ]);
    return { ...syncData, ...localData };
  }
};

// Check storage size and auto-backup if needed
async function checkStorageSize() {
  try {
    const bytesInUse = await chrome.storage.local.getBytesInUse(null);
    const mbUsed = bytesInUse / (1024 * 1024);
    console.log(`Storage used: ${mbUsed.toFixed(2)} MB`);

    // Auto-backup when reaching 9MB
    if (mbUsed >= 9) {
      console.log('Storage approaching limit, triggering auto-backup...');
      const connected = await DriveSync.isDriveConnected();
      if (connected) {
        await DriveSync.uploadBackup();
        console.log('Auto-backup completed');
      } else {
        console.log('Drive not connected, cannot auto-backup');
      }
    }
  } catch (e) {
    console.log('Storage check error:', e);
  }
}

// Tracking state (in-memory, persisted to storage periodically)
let state = {
  currentDomain: null,
  startTime: null,
  pendingTime: {},    // { domain: milliseconds }
  pendingVisits: {},  // { domain: count } - visits to save
  isTracking: true
};

// ============ Utility Functions ============

/**
 * Extract hostname from URL
 * @param {string} url
 * @returns {string|null}
 */
function extractDomain(url) {
  try {
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      return null;
    }
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Get next midnight timestamp
 * @returns {number}
 */
function getNextMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime();
}

/**
 * Format today's date as string
 * @returns {string}
 */
function getTodayString() {
  return new Date().toDateString();
}

/**
 * Get timestamp for specific time today (or tomorrow if past)
 * @param {string} timeStr - "HH:MM" format
 * @returns {number}
 */
function getTimeToday(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  // If time already passed today, schedule for tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime();
}

// ============ Time Tracking ============

/**
 * Accumulate time for a domain
 * @param {string} domain
 * @param {number} ms - milliseconds
 */
function accumulateTime(domain, ms) {
  if (!domain || ms <= 0) return;
  state.pendingTime[domain] = (state.pendingTime[domain] || 0) + ms;
}

/**
 * Get current tracking info for popup
 * @returns {Object}
 */
function getCurrentTrackingInfo() {
  let currentSeconds = 0;
  if (state.currentDomain && state.startTime) {
    currentSeconds = Math.floor((Date.now() - state.startTime) / 1000);
  }

  return {
    currentDomain: state.currentDomain,
    currentSeconds: currentSeconds,
    pendingTime: { ...state.pendingTime }
  };
}

/**
 * Handle tab change - save previous, start new tracking
 * @param {string} url
 */
async function handleTabChange(url) {
  // Check if tracking is enabled
  const data = await Storage.get('settings');
  const settings = data.settings || { trackingEnabled: true };

  if (!settings.trackingEnabled) {
    state.currentDomain = null;
    state.startTime = null;
    return;
  }

  const newDomain = extractDomain(url);

  // Save time for previous domain
  if (state.currentDomain && state.startTime) {
    const elapsed = Date.now() - state.startTime;
    accumulateTime(state.currentDomain, elapsed);
  }

  // Start tracking new domain
  state.currentDomain = newDomain;
  state.startTime = newDomain ? Date.now() : null;
}

/**
 * Pause tracking (window blur, idle, etc.)
 */
async function pauseTracking() {
  if (state.currentDomain && state.startTime) {
    const elapsed = Date.now() - state.startTime;
    accumulateTime(state.currentDomain, elapsed);
    await savePendingTime();
  }
  state.startTime = null;
}

/**
 * Resume tracking
 */
function resumeTracking() {
  if (state.currentDomain && !state.startTime) {
    state.startTime = Date.now();
  }
}

/**
 * Save pending time and visits to storage
 */
async function savePendingTime() {
  // Also save current session time
  if (state.currentDomain && state.startTime) {
    const elapsed = Date.now() - state.startTime;
    accumulateTime(state.currentDomain, elapsed);
    state.startTime = Date.now();  // Reset for next interval
  }

  const hasTime = Object.keys(state.pendingTime).length > 0;
  const hasVisits = Object.keys(state.pendingVisits).length > 0;
  if (!hasTime && !hasVisits) return;

  const data = await Storage.get('domains');
  const domains = data.domains || {};
  const today = getTodayString();

  // Save pending time
  for (const [domain, ms] of Object.entries(state.pendingTime)) {
    if (!domains[domain]) {
      domains[domain] = { today: 0, total: 0, todayDate: today, visitsToday: 0, visitsTotal: 0 };
    }

    // Reset if new day
    if (domains[domain].todayDate !== today) {
      domains[domain].today = 0;
      domains[domain].visitsToday = 0;
      domains[domain].todayDate = today;
    }

    const seconds = Math.round(ms / 1000);
    domains[domain].today += seconds;
    domains[domain].total += seconds;
    domains[domain].lastVisit = Date.now();
  }

  // Save pending visits
  for (const [domain, count] of Object.entries(state.pendingVisits)) {
    if (!domains[domain]) {
      domains[domain] = { today: 0, total: 0, todayDate: today, visitsToday: 0, visitsTotal: 0 };
    }

    // Reset if new day
    if (domains[domain].todayDate !== today) {
      domains[domain].today = 0;
      domains[domain].visitsToday = 0;
      domains[domain].todayDate = today;
    }

    domains[domain].visitsToday = (domains[domain].visitsToday || 0) + count;
    domains[domain].visitsTotal = (domains[domain].visitsTotal || 0) + count;
  }

  await Storage.set({ domains });
  state.pendingTime = {};
  state.pendingVisits = {};
}

/**
 * Save today's data to history before reset
 * Format: history[YYYY-MM-DD] = { time: { domain: seconds }, visits: { domain: count } }
 */
async function saveToHistory() {
  const data = await Storage.get(['domains', 'history']);
  const domains = data.domains || {};
  const history = data.history || {};

  const today = new Date();
  const dateKey = today.toISOString().split('T')[0]; // YYYY-MM-DD

  // Collect today's data
  const todayTime = {};
  const todayVisits = {};
  const todayStr = today.toDateString();

  for (const [domain, info] of Object.entries(domains)) {
    if (info.todayDate === todayStr && info.today > 0) {
      todayTime[domain] = info.today;
      todayVisits[domain] = info.visitsToday || 0;
    }
  }

  if (Object.keys(todayTime).length > 0) {
    history[dateKey] = { time: todayTime, visits: todayVisits };
    // No day limit - store indefinitely (auto-backup handles large data)
    await Storage.set({ history });
  }
}

/**
 * Reset daily counters and update streaks
 */
async function resetDailyCounters() {
  // Save today's data to history first
  await saveToHistory();

  const data = await Storage.get(['domains', 'settings', 'streaks']);
  const domains = data.domains || {};
  const settings = data.settings || { limits: {} };
  const streaks = data.streaks || { current: 0, best: 0, lastDate: null };

  // Check if stayed within limits yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  let withinLimits = true;
  const limits = settings.limits || {};

  for (const [domain, limitMinutes] of Object.entries(limits)) {
    if (domains[domain] && domains[domain].todayDate === yesterdayStr) {
      const limitSeconds = limitMinutes * 60;
      if (domains[domain].today > limitSeconds) {
        withinLimits = false;
        break;
      }
    }
  }

  // Update streak
  const today = getTodayString();
  if (withinLimits && streaks.lastDate === yesterdayStr) {
    streaks.current++;
    streaks.best = Math.max(streaks.best, streaks.current);
  } else if (streaks.lastDate !== yesterdayStr) {
    // Broke streak or first day
    if (Object.keys(limits).length > 0) {
      streaks.current = withinLimits ? 1 : 0;
    }
  }
  streaks.lastDate = today;

  // Reset today counters for all domains
  for (const domain in domains) {
    if (domains[domain].todayDate !== today) {
      domains[domain].today = 0;
      domains[domain].todayDate = today;
    }
  }

  await Storage.set({ domains, streaks });
}

/**
 * Initialize tracking - get current active tab
 */
async function initializeTracking() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      state.currentDomain = extractDomain(tab.url);
      state.startTime = state.currentDomain ? Date.now() : null;
    }
  } catch (e) {
    console.error('Failed to initialize tracking:', e);
  }
}

// ============ Reminders/Notifications ============

/**
 * Show a notification
 * @param {string} id - Notification ID
 * @param {string} title
 * @param {string} message
 */
function showNotification(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: title,
    message: message,
    priority: 2
  }, (notificationId) => {
    if (chrome.runtime.lastError) {
      console.error('Notification error:', chrome.runtime.lastError);
    } else {
      console.log('Notification shown:', notificationId);
    }
  });
}

/**
 * Auto backup to Google Drive (runs daily)
 */
async function autoBackupToDrive() {
  try {
    // Check if connected
    const connected = await DriveSync.isDriveConnected();
    if (!connected) {
      console.log('Auto-backup skipped: not connected to Drive');
      return;
    }

    // Save pending time first
    await savePendingTime();

    // Perform backup
    const result = await DriveSync.uploadBackup();
    if (result.success) {
      console.log('Auto-backup completed:', new Date().toISOString());
    } else {
      console.log('Auto-backup failed:', result.error);
    }
  } catch (e) {
    console.log('Auto-backup error:', e);
  }
}

/**
 * Setup reminder alarms from settings
 */
async function setupReminders() {
  const data = await Storage.get('reminders');
  const reminders = data.reminders || [];

  console.log('Setting up reminders:', reminders.length, 'total');

  // Clear existing reminder alarms
  const alarms = await chrome.alarms.getAll();
  for (const alarm of alarms) {
    if (alarm.name.startsWith('reminder-')) {
      await chrome.alarms.clear(alarm.name);
    }
  }

  // Create alarms for each enabled reminder
  for (const reminder of reminders) {
    if (!reminder.enabled) {
      console.log('Skipping disabled reminder:', reminder.id);
      continue;
    }

    const alarmName = `reminder-${reminder.id}`;

    if (reminder.type === 'interval') {
      // Interval-based reminder (every X minutes)
      // Chrome minimum is 1 minute
      const intervalMin = Math.max(1, reminder.interval);
      chrome.alarms.create(alarmName, {
        delayInMinutes: intervalMin,
        periodInMinutes: intervalMin
      });
      console.log('Created interval alarm:', alarmName, 'every', intervalMin, 'min');
    } else if (reminder.type === 'daily') {
      // Daily reminder at specific time
      const when = getTimeToday(reminder.time);
      chrome.alarms.create(alarmName, {
        when: when,
        periodInMinutes: 24 * 60  // Repeat daily
      });
      console.log('Created daily alarm:', alarmName, 'at', new Date(when).toLocaleString());
    }
  }

  // Log all active alarms
  const activeAlarms = await chrome.alarms.getAll();
  console.log('Active alarms:', activeAlarms.map(a => a.name));
}

/**
 * Handle reminder alarm
 * @param {string} alarmName
 */
async function handleReminderAlarm(alarmName) {
  const reminderId = alarmName.replace('reminder-', '');
  console.log('Handling reminder alarm, ID:', reminderId);

  const data = await Storage.get('reminders');
  const reminders = data.reminders || [];
  console.log('Found reminders in storage:', reminders.length);

  const reminder = reminders.find(r => r.id === reminderId);
  console.log('Matched reminder:', reminder);

  if (reminder && reminder.enabled) {
    console.log('Showing reminder popup for:', reminder.title);

    // Send popup to active tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        // Try to inject content script first (in case tab was open before extension loaded)
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/floating-timer.js']
          });
        } catch (injectErr) {
          // Script might already be injected, ignore
          console.log('Script inject skipped (already exists or not allowed):', injectErr.message);
        }

        // Small delay to let script initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        await chrome.tabs.sendMessage(tab.id, {
          type: 'showReminder',
          reminderId: reminder.id,
          icon: reminder.icon || '⏰',
          title: reminder.title || 'Reminder',
          message: reminder.message || 'Time for a break!',
          actions: reminder.actions || ['Got it!']
        });
        console.log('Reminder popup sent to tab:', tab.id);
      } else {
        // Fallback to notification if no valid tab
        showNotification(alarmName, reminder.title, reminder.message);
      }
    } catch (e) {
      console.log('Could not send to tab, using notification:', e);
      showNotification(alarmName, reminder.title, reminder.message);
    }
  } else {
    console.log('Reminder not found or disabled');
  }
}

// ============ Event Listeners ============

// Tab activated (switched to different tab)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await handleTabChange(tab.url);
  } catch (e) {
    // Tab might be closed
  }
});

// Tab URL updated (navigation in same tab)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    handleTabChange(changeInfo.url);
  }
});

// Window focus changed
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    pauseTracking();
  } else {
    // Get active tab in focused window
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (tabs[0]?.url) {
        handleTabChange(tabs[0].url);
      }
    });
  }
});

// Idle state changed
chrome.idle.onStateChanged.addListener((newState) => {
  if (newState === 'idle' || newState === 'locked') {
    pauseTracking();
  } else {
    resumeTracking();
  }
});

// Count visits only for direct navigation (typed URL, bookmark, new tab)
// NOT counted: clicking links from other sites, back/forward navigation
chrome.webNavigation.onCommitted.addListener((details) => {
  // Only count main frame, not iframes
  if (details.frameId !== 0) return;

  // Direct navigation types that count as visits
  const directTypes = ['typed', 'auto_bookmark', 'generated', 'keyword', 'keyword_generated'];

  if (directTypes.includes(details.transitionType)) {
    const domain = extractDomain(details.url);
    if (domain) {
      state.pendingVisits[domain] = (state.pendingVisits[domain] || 0) + 1;
      console.log('Visit counted:', domain, 'type:', details.transitionType);
    }
  }
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'focus-clock') {
    chrome.tabs.create({ url: chrome.runtime.getURL('clock/clock.html') });
  }
});

// Alarm handlers
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('Alarm triggered:', alarm.name);
  if (alarm.name === 'save') {
    savePendingTime().then(() => saveToHistory());
  } else if (alarm.name === 'daily-reset') {
    resetDailyCounters();
  } else if (alarm.name === 'daily-backup') {
    autoBackupToDrive();
  } else if (alarm.name.startsWith('reminder-')) {
    console.log('Reminder alarm fired:', alarm.name);
    handleReminderAlarm(alarm.name);
  }
});

// Message handler for popup communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getTrackingState') {
    // Return current tracking info for real-time display
    sendResponse(getCurrentTrackingInfo());
  } else if (message.type === 'saveNow') {
    // Force save pending time
    savePendingTime().then(() => sendResponse({ success: true }));
    return true;  // Keep channel open for async response
  } else if (message.type === 'refreshReminders') {
    // Reload reminder alarms
    setupReminders().then(() => sendResponse({ success: true }));
    return true;
  }
  // Google Drive sync handlers
  else if (message.type === 'driveConnect') {
    DriveSync.connectDrive().then(success => sendResponse({ success }));
    return true;
  } else if (message.type === 'driveDisconnect') {
    DriveSync.disconnectDrive().then(() => sendResponse({ success: true }));
    return true;
  } else if (message.type === 'driveStatus') {
    DriveSync.getSyncStatus().then(status => sendResponse(status));
    return true;
  } else if (message.type === 'driveBackup') {
    // Save pending time first, then backup
    savePendingTime()
      .then(() => DriveSync.uploadBackup())
      .then(result => sendResponse(result));
    return true;
  } else if (message.type === 'driveRestore') {
    DriveSync.downloadBackup().then(result => {
      if (result.success) {
        // Reload reminders after restore
        setupReminders();
      }
      sendResponse(result);
    });
    return true;
  } else if (message.type === 'recordHabitAction') {
    // Record habit tracker action
    recordHabitAction(message.reminderId, message.status)
      .then(() => sendResponse({ success: true }));
    return true;
  }
});


/** * Record habit action for heatmap tracker * @param {string} reminderId - Reminder ID * @param {string} status - done, partial, or skipped */async function recordHabitAction(reminderId, status) {  if (status !== "done") return;  const reminderData = await Storage.get("reminders");  const reminders = reminderData.reminders || [];  const reminder = reminders.find(r => r.id === reminderId);  if (!reminder) return;  const today = new Date().toDateString();  const habitName = reminder.title || "Habit";  const habitIcon = reminder.icon || "🎯";  const data = await Storage.get("habitTracker");  const habitTracker = data.habitTracker || {};  if (!habitTracker[today]) habitTracker[today] = {};  if (!habitTracker[today][habitName]) {    habitTracker[today][habitName] = { icon: habitIcon, count: 0 };  }  habitTracker[today][habitName].count++;  await Storage.set({ habitTracker });  console.log("Habit tracked:", habitName, habitTracker[today][habitName].count);}
// Extension installed/updated
chrome.runtime.onInstalled.addListener(async () => {
  // Create context menu for fullscreen clock
  chrome.contextMenus.create({
    id: 'focus-clock',
    title: 'Focus Clock',
    contexts: ['action']  // Right-click on extension icon
  });

  // Initialize storage with defaults
  const data = await Storage.getAll();

  // Initialize local storage (large data)
  if (!data.domains) {
    await chrome.storage.local.set({ domains: {} });
  }
  if (!data.history) {
    await chrome.storage.local.set({ history: {} });
  }
  if (!data.habitTracker) {
    await chrome.storage.local.set({ habitTracker: {} });
  }

  // Initialize sync storage (small data, syncs across devices)
  if (!data.settings) {
    await chrome.storage.sync.set({
      settings: { limits: {}, trackingEnabled: true }
    });
  }
  if (!data.streaks) {
    await chrome.storage.sync.set({
      streaks: { current: 0, best: 0, lastDate: null }
    });
  }
  if (!data.reminders) {
    await chrome.storage.sync.set({ reminders: [] });
  }

  // Setup alarms (Chrome minimum is 1 minute)
  chrome.alarms.create('save', { periodInMinutes: 1 });
  chrome.alarms.create('daily-reset', {
    when: getNextMidnight(),
    periodInMinutes: 24 * 60
  });
  // Auto-backup alarm (runs 1 hour after midnight)
  chrome.alarms.create('daily-backup', {
    when: getNextMidnight() + (60 * 60 * 1000),
    periodInMinutes: 24 * 60
  });

  await setupReminders();
  await initializeTracking();
});

// Extension startup (browser restart)
chrome.runtime.onStartup.addListener(async () => {
  // Recreate alarms
  chrome.alarms.create('save', { periodInMinutes: 1 });
  chrome.alarms.create('daily-reset', {
    when: getNextMidnight(),
    periodInMinutes: 24 * 60
  });
  chrome.alarms.create('daily-backup', {
    when: getNextMidnight() + (60 * 60 * 1000),
    periodInMinutes: 24 * 60
  });

  await setupReminders();
  await initializeTracking();
});

// Initialize on service worker start
initializeTracking();
setupReminders();  // Ensure reminders are set up when service worker wakes

console.log('Focus Timer service worker started');
