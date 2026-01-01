# Chrome Web Store - Permissions & Remote Code Justification

## Permissions Justification

| Permission | Justification |
|------------|---------------|
| `tabs` | Required to detect which website the user is currently viewing. Used to track time spent on each domain and display the floating timer on active tabs. |
| `storage` | Required to save user settings (time limits, reminders) and sync them across Chrome browsers using chrome.storage.sync API. |
| `unlimitedStorage` | Required to store browsing history data (domains, time spent, visit counts) locally. Data can grow large over months/years of usage. No data is sent to external servers. |
| `alarms` | Required for: (1) Periodic data saving every 1 minute, (2) Daily reset at midnight, (3) Reminder notifications at user-configured intervals or times. |
| `idle` | Required to pause time tracking when user is away from computer (idle/locked). Prevents inaccurate time tracking when user is not actively browsing. |
| `notifications` | Required to show reminder notifications when user-configured habits are due (e.g., "Drink water", "Take a break"). Fallback when in-page popup cannot be shown. |
| `identity` | Required for optional Google Drive backup feature. Uses Chrome's identity API to authenticate with user's own Google account. User must explicitly enable this feature. |
| `scripting` | Required to inject the floating timer and reminder popup into web pages. Shows real-time time spent on current domain. |
| `webNavigation` | Required to count website visits accurately. Only counts direct navigation (typed URL, bookmarks) not link clicks from other sites. |
| `contextMenus` | Required for Focus Clock feature. Adds "Focus Clock" option when right-clicking the extension icon. |

## Host Permissions Justification

| Permission | Justification |
|------------|---------------|
| `<all_urls>` | Required to track time and show floating timer on all websites. The extension's core feature is tracking time spent across all domains the user visits. No data is collected from page content - only the domain name and time spent. |

## Remote Code Justification

### 1. Google Fonts (fonts.googleapis.com)
- **Files**: `clock/clock.html`
- **Purpose**: Loads "Anton" font for the Focus Clock fullscreen display
- **Justification**: Pure CSS font loading for visual styling only. No JavaScript execution. Google Fonts is a trusted, widely-used service.
- **Data sent**: Only standard font request (font name, format)
- **Alternative**: Could bundle font file locally to remove this dependency

### 2. Google Drive API (googleapis.com)
- **Files**: `services/drive-sync.js`
- **Purpose**: Optional backup/sync feature to user's own Google Drive
- **Justification**:
  - Feature is 100% opt-in - user must explicitly connect their Google account
  - Uses only `drive.appdata` scope - can only access app-specific hidden folder
  - Cannot read/write user's personal files
  - All data goes to USER'S OWN Google Drive account
  - Used for: backup settings, restore from backup
- **Data sent**: Extension data (settings, time tracking history) encrypted in transit via HTTPS

### 3. Google OAuth (accounts.google.com)
- **Files**: `services/drive-sync.js`
- **Purpose**: Token revocation when user disconnects Google Drive
- **Justification**: Standard OAuth2 flow to properly revoke access token when user wants to disconnect their account
- **Data sent**: Only the access token for revocation

## No Remote Code Execution

- All JavaScript code is bundled locally in the extension
- Chart.js library (`lib/chart.min.js`) is bundled locally, not loaded from CDN
- No `eval()`, `new Function()`, or dynamic script loading
- No content from external sources is executed as code

## Privacy Summary

- All tracking data stored locally on user's device
- Optional Google Drive sync goes to user's own account only
- No analytics, advertising, or third-party data sharing
- Open source: https://github.com/Suharaz/focus-timer

---

## Single Purpose Description

**Focus Timer** helps users track and manage their browsing time. It:
1. Tracks time spent on each website
2. Allows setting daily time limits
3. Shows reminders for healthy habits
4. Provides a distraction-free focus clock

All features serve the single purpose of helping users manage their time and stay focused while browsing.
