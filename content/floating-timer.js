

(function() {
  // Don't run on extension pages
  if (window.location.protocol === 'chrome-extension:') return;

  // Prevent duplicate initialization
  if (window.__focusTimerInitialized) return;
  window.__focusTimerInitialized = true;

  let timerElement = null;
  let blockOverlay = null;
  let dataFetchInterval = null;
  let displayInterval = null;
  let currentDomain = window.location.hostname;
  let isBlocked = false;

  // Real-time display: fetch data every 5s, display every 1s
  let lastFetchedSeconds = 0;
  let lastFetchTime = 0;
  let currentLimit = null;

  /**
   * Create the floating timer element
   */
  function createTimer() {
    // Check if already exists
    if (document.getElementById('focus-timer-floating')) return;

    timerElement = document.createElement('div');
    timerElement.id = 'focus-timer-floating';
    timerElement.innerHTML = `
      <div class="ft-icon">⏱️</div>
      <div class="ft-time">0:00</div>
    `;

    // Inject styles
    const style = document.createElement('style');
    style.textContent = `
      #focus-timer-floating {
        position: fixed;
        bottom: 20px;
        left: 20px;
        background: rgba(17, 24, 39, 0.8);
        color: #f9fafb;
        padding: 8px 14px;
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
        z-index: 2147483647;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        cursor: default;
        user-select: none;
        transition: opacity 0.2s, transform 0.2s;
        opacity: 0.8;
      }

      #focus-timer-floating:hover {
        opacity: 1;
        transform: scale(1.05);
      }

      #focus-timer-floating .ft-icon {
        font-size: 16px;
      }

      #focus-timer-floating .ft-time {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        min-width: 45px;
      }

      #focus-timer-floating.ft-warning {
        background: rgba(245, 158, 11, 0.9);
      }

      #focus-timer-floating.ft-over {
        background: rgba(239, 68, 68, 0.9);
      }

      #focus-timer-floating.ft-hidden {
        display: none;
      }

      /* Block overlay styles */
      #focus-timer-block-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.95);
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #fff;
      }

      #focus-timer-block-overlay .block-icon {
        font-size: 80px;
        margin-bottom: 24px;
      }

      #focus-timer-block-overlay .block-title {
        font-size: 32px;
        font-weight: 700;
        margin-bottom: 12px;
        color: #ef4444;
      }

      #focus-timer-block-overlay .block-message {
        font-size: 18px;
        color: #9ca3af;
        margin-bottom: 8px;
      }

      #focus-timer-block-overlay .block-domain {
        font-size: 24px;
        font-weight: 600;
        color: #f59e0b;
        margin-bottom: 24px;
      }

      #focus-timer-block-overlay .block-time {
        font-size: 48px;
        font-weight: 700;
        color: #ef4444;
        font-variant-numeric: tabular-nums;
        margin-bottom: 32px;
      }

      #focus-timer-block-overlay .block-hint {
        font-size: 14px;
        color: #6b7280;
        text-align: center;
        max-width: 400px;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(timerElement);
  }

  /**
   * Create and show the block overlay
   */
  function showBlockOverlay(timeSpent, limitMinutes) {
    if (blockOverlay) return; // Already showing

    blockOverlay = document.createElement('div');
    blockOverlay.id = 'focus-timer-block-overlay';
    blockOverlay.innerHTML = `
      <div class="block-icon">🚫</div>
      <div class="block-title">Time Limit Reached!</div>
      <div class="block-message">You've exceeded your limit on</div>
      <div class="block-domain">${currentDomain}</div>
      <div class="block-time">${formatTime(timeSpent)} / ${limitMinutes}m</div>
      <div class="block-hint">Close this tab to stay productive.<br>Your daily limit will reset at midnight.</div>
    `;

    document.body.appendChild(blockOverlay);
    isBlocked = true;

    // Prevent scrolling
    document.body.style.overflow = 'hidden';
  }

  /**
   * Update block overlay time
   */
  function updateBlockOverlay(timeSpent, limitMinutes) {
    if (!blockOverlay) return;
    const timeEl = blockOverlay.querySelector('.block-time');
    if (timeEl) {
      timeEl.textContent = `${formatTime(timeSpent)} / ${limitMinutes}m`;
    }
  }

  /**
   * Format seconds to m:ss or h:mm:ss
   */
  function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const pad = (n) => n.toString().padStart(2, '0');

    if (hours > 0) {
      return `${hours}:${pad(mins)}:${pad(secs)}`;
    }
    return `${mins}:${pad(secs)}`;
  }

  /**
   * Fetch data from storage/service worker (runs every 5s)
   */
  async function fetchData() {
    if (!timerElement) return;

    // Check if extension context is still valid
    if (!chrome.runtime || !chrome.runtime.id) {
      console.log('Focus Timer: Extension context lost, cleaning up');
      cleanup();
      return;
    }

    try {
      // Get tracking state from service worker
      const trackingState = await chrome.runtime.sendMessage({ type: 'getTrackingState' });

      // Fetch fresh data
      const [localData, syncData] = await Promise.all([
        chrome.storage.local.get('domains'),
        chrome.storage.sync.get('settings')
      ]);
      const domains = localData.domains || {};
      const settings = syncData.settings || {};
      const limits = settings.limits || {};

      // Check if tracking is enabled
      if (settings.trackingEnabled === false) {
        timerElement.classList.add('ft-hidden');
        return;
      }

      timerElement.classList.remove('ft-hidden');

      // Calculate total time for current domain
      const today = new Date().toDateString();
      let totalSeconds = 0;

      // Add stored time
      if (domains[currentDomain] && domains[currentDomain].todayDate === today) {
        totalSeconds = domains[currentDomain].today;
      }

      // Add pending time
      if (trackingState && trackingState.pendingTime && trackingState.pendingTime[currentDomain]) {
        totalSeconds += Math.floor(trackingState.pendingTime[currentDomain] / 1000);
      }

      // Add live tracking time from service worker
      if (trackingState && trackingState.currentDomain === currentDomain) {
        totalSeconds += trackingState.currentSeconds;
      }

      // Store for real-time display interpolation
      lastFetchedSeconds = totalSeconds;
      lastFetchTime = Date.now();
      currentLimit = limits[currentDomain] || null;

      // Update display immediately
      updateDisplay();
    } catch (e) {
      if (e.message && (
        e.message.includes('Extension context invalidated') ||
        e.message.includes('message port closed') ||
        e.message.includes('Receiving end does not exist')
      )) {
        console.log('Focus Timer: Extension context lost, cleaning up');
        cleanup();
        return;
      }
    }
  }

  /**
   * Update display with real-time counting (runs every 1s)
   */
  function updateDisplay() {
    if (!timerElement) return;

    // Calculate current seconds by adding elapsed time since last fetch
    const elapsed = Math.floor((Date.now() - lastFetchTime) / 1000);
    const totalSeconds = lastFetchedSeconds + elapsed;

    // Update time display
    const timeEl = timerElement.querySelector('.ft-time');
    timeEl.textContent = formatTime(totalSeconds);

    // Update color based on limit
    timerElement.classList.remove('ft-warning', 'ft-over');

    if (currentLimit) {
      const limitSeconds = currentLimit * 60;
      const percent = (totalSeconds / limitSeconds) * 100;

      if (percent >= 100) {
        timerElement.classList.add('ft-over');
        if (!isBlocked) {
          showBlockOverlay(totalSeconds, currentLimit);
        } else {
          updateBlockOverlay(totalSeconds, currentLimit);
        }
      } else if (percent >= 75) {
        timerElement.classList.add('ft-warning');
      }
    }
  }

  /**
   * Cleanup when extension context is invalidated
   * NOTE: Does NOT remove reminder popup - user must interact with it
   */
  function cleanup() {
    if (dataFetchInterval) {
      clearInterval(dataFetchInterval);
      dataFetchInterval = null;
    }
    if (displayInterval) {
      clearInterval(displayInterval);
      displayInterval = null;
    }
    if (timerElement) {
      timerElement.remove();
      timerElement = null;
    }
    if (blockOverlay) {
      blockOverlay.remove();
      blockOverlay = null;
    }
    // Keep reminder popup - user must click button to dismiss
    // Only cleanup popup reference, don't remove DOM
    window.__focusTimerInitialized = false;
  }

  /**
   * Start all intervals
   */
  function startIntervals() {
    // Fetch data every 5 seconds
    if (!dataFetchInterval) {
      dataFetchInterval = setInterval(fetchData, 5000);
    }
    // Update display every 1 second for real-time counting
    if (!displayInterval) {
      displayInterval = setInterval(updateDisplay, 1000);
    }
  }

  /**
   * Stop all intervals
   */
  function stopIntervals() {
    if (dataFetchInterval) {
      clearInterval(dataFetchInterval);
      dataFetchInterval = null;
    }
    if (displayInterval) {
      clearInterval(displayInterval);
      displayInterval = null;
    }
  }

  /**
   * Initialize the floating timer
   */
  function init() {
    // Wait for body to be ready
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    createTimer();
    fetchData(); // Initial fetch
    startIntervals();

    // Pause updates when tab is hidden (performance optimization)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopIntervals();
      } else {
        // Resume - fetch fresh data immediately
        fetchData();
        startIntervals();
      }
    });
  }

  // Start
  init();

  // Cleanup on page unload
  window.addEventListener('beforeunload', stopIntervals);

  // ============ Reminder Popup ============

  let reminderPopup = null;
  let reminderQueue = [];  // Queue for multiple reminders
  let isShowingReminder = false;

  /**
   * Add reminder to queue and show if not already showing
   */
  function queueReminder(icon, title, message, actions, reminderId) {
    reminderQueue.push({ icon, title, message, actions, reminderId });
    if (!isShowingReminder) {
      showNextReminder();
    }
  }

  /**
   * Show next reminder from queue
   */
  function showNextReminder() {
    if (reminderQueue.length === 0) {
      isShowingReminder = false;
      return;
    }
    isShowingReminder = true;
    const next = reminderQueue.shift();
    showReminderPopup(next.icon, next.title, next.message, next.actions, next.reminderId);
  }

  /**
   * Show reminder popup with action buttons
   * @param {string} reminderId - ID of the reminder for tracking
   */
  function showReminderPopup(icon, title, message, actions = ['Got it!'], reminderId = null) {
    // Remove existing popup if any (shouldn't happen with queue, but safety check)
    if (reminderPopup) {
      reminderPopup.remove();
    }
    // Remove existing backdrop
    const existingBackdrop = document.getElementById('focus-timer-reminder-backdrop');
    if (existingBackdrop) existingBackdrop.remove();

    // Inject popup styles if not exists
    if (!document.getElementById('focus-timer-reminder-styles')) {
      const style = document.createElement('style');
      style.id = 'focus-timer-reminder-styles';
      style.textContent = `
        #focus-timer-reminder {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) scale(0.9);
          width: 380px;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: 24px;
          padding: 32px;
          z-index: 2147483647;
          box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5), 0 0 100px rgba(139, 92, 246, 0.15);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          text-align: center;
          opacity: 0;
          animation: reminderPopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        @keyframes reminderPopIn {
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }

        @keyframes reminderPopOut {
          to {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.9);
          }
        }

        #focus-timer-reminder.closing {
          animation: reminderPopOut 0.3s ease forwards;
        }

        #focus-timer-reminder .reminder-icon {
          font-size: 64px;
          margin-bottom: 12px;
          display: block;
          animation: reminderBounce 2s ease-in-out infinite;
        }

        @keyframes reminderBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }

        #focus-timer-reminder .reminder-title {
          font-size: 24px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 20px;
        }

        #focus-timer-reminder .reminder-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          justify-content: center;
        }

        #focus-timer-reminder .reminder-btn {
          border: none;
          color: white;
          padding: 12px 24px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
          min-width: 100px;
        }

        #focus-timer-reminder .reminder-btn:hover {
          transform: scale(1.05);
        }

        #focus-timer-reminder .reminder-btn.primary {
          background: linear-gradient(135deg, #10b981, #059669);
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        }

        #focus-timer-reminder .reminder-btn.primary:hover {
          box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);
        }

        #focus-timer-reminder .reminder-btn.secondary {
          background: linear-gradient(135deg, #8b5cf6, #a855f7);
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
        }

        #focus-timer-reminder .reminder-btn.secondary:hover {
          box-shadow: 0 8px 24px rgba(139, 92, 246, 0.4);
        }

        #focus-timer-reminder .reminder-btn.tertiary {
          background: rgba(255, 255, 255, 0.1);
          box-shadow: none;
        }

        #focus-timer-reminder .reminder-btn.tertiary:hover {
          background: rgba(255, 255, 255, 0.15);
        }

        #focus-timer-reminder-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(8px);
          z-index: 2147483646;
          opacity: 0;
          animation: fadeIn 0.3s ease forwards;
        }

        @keyframes fadeIn {
          to { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'focus-timer-reminder-backdrop';

    // Generate action buttons HTML
    const buttonStyles = ['primary', 'secondary', 'tertiary'];
    const buttonsHtml = actions.map((action, idx) => {
      const style = buttonStyles[Math.min(idx, buttonStyles.length - 1)];
      return `<button class="reminder-btn ${style}">${action}</button>`;
    }).join('');

    // Create popup
    reminderPopup = document.createElement('div');
    reminderPopup.id = 'focus-timer-reminder';
    reminderPopup.innerHTML = `
      <span class="reminder-icon">${icon}</span>
      <div class="reminder-title">${title}</div>
      <div class="reminder-actions">${buttonsHtml}</div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(reminderPopup);

    // Block scrolling while popup is shown
    document.body.style.overflow = 'hidden';

    let actionRecorded = false;

    // Record action to service worker
    const recordAction = (actionIndex) => {
      if (actionRecorded || !reminderId) return;
      actionRecorded = true;

      // Map action index to status: 0=done, 1=partial, 2+=skipped
      const status = actionIndex === 0 ? 'done' : actionIndex === 1 ? 'partial' : 'skipped';

      try {
        chrome.runtime.sendMessage({
          type: 'recordHabitAction',
          reminderId: reminderId,
          status: status
        }).catch(() => {});
      } catch (e) {
        // Context might be invalid
      }
    };

    // Dismiss handler
    const dismiss = (actionIndex = -1) => {
      if (!reminderPopup) return;

      // Record action if button clicked, or 'skipped' if dismissed other way
      if (actionIndex >= 0) {
        recordAction(actionIndex);
      } else if (!actionRecorded) {
        recordAction(2); // Backdrop click or auto-dismiss = skipped
      }

      reminderPopup.classList.add('closing');
      backdrop.style.animation = 'fadeIn 0.3s ease reverse forwards';
      setTimeout(() => {
        backdrop.remove();
        if (reminderPopup) {
          reminderPopup.remove();
          reminderPopup = null;
        }
        // Restore scrolling only if no more reminders in queue
        if (reminderQueue.length === 0) {
          document.body.style.overflow = '';
        }
        // Show next reminder from queue
        showNextReminder();
      }, 300);
    };

    // All action buttons dismiss the popup with their index
    // User MUST click a button - no backdrop dismiss, no auto-dismiss
    reminderPopup.querySelectorAll('.reminder-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => dismiss(idx));
    });
  }

  // Listen for reminder messages from service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'showReminder') {
      queueReminder(message.icon, message.title, message.message, message.actions, message.reminderId);
      sendResponse({ received: true });
    }
  });
})();
