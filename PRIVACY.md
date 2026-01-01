# Privacy Policy for Focus Timer

**Last updated:** January 1, 2026

## Overview

Focus Timer is a browser extension designed to help you track and manage your time spent on websites. We are committed to protecting your privacy and being transparent about our data practices.

**This extension is open source.** You can review the complete source code at: [GitHub Repository URL]

## Data Collection

### What We Collect

Focus Timer collects the following data **locally on your device**:

1. **Browsing Data**
   - Domain names (hostnames) of websites you visit
   - Time spent on each domain
   - Number of visits to each domain
   - Timestamps of visits

2. **User Settings**
   - Time limits you set for specific websites
   - Reminder configurations (titles, schedules, messages)
   - Extension preferences

3. **Habit Tracking Data**
   - Habit completion records
   - Daily habit statistics

### What We Do NOT Collect

- Full URLs or page content
- Personal information (name, email, etc.)
- Browsing history beyond domain names
- Passwords or form data
- Any data from private/incognito mode
- Cross-site tracking data

## Data Storage

### Local Storage
All data is stored **locally on your device** using Chrome's built-in storage APIs:
- `chrome.storage.local` - For large data (domains, history, habits)
- `chrome.storage.sync` - For settings (synced across your Chrome browsers if you're signed in)

### Optional Cloud Backup (Google Drive)
If you choose to enable Google Drive sync:
- Data is backed up to **your own Google Drive account**
- Stored in the app-specific folder (not accessible to other apps)
- We do not have access to your Google Drive or backup data
- You can disconnect and delete backups at any time

## Data Sharing

**We do not share, sell, or transfer your data to any third parties.**

- No analytics services
- No advertising networks
- No data brokers
- No third-party servers

## Permissions Explained

| Permission | Why We Need It |
|------------|----------------|
| `tabs` | To track which domain you're currently viewing |
| `storage` | To save your settings and tracking data locally |
| `alarms` | To trigger reminders and periodic data saves |
| `notifications` | To show reminder notifications |
| `idle` | To pause tracking when you're away from computer |
| `identity` | For optional Google Drive authentication |
| `webNavigation` | To count direct visits (not link clicks) |
| `contextMenus` | For right-click menu (Focus Clock) |
| `scripting` | To inject floating timer on pages |

## Your Rights

You have full control over your data:

1. **View** - Access all your data in the Dashboard
2. **Export** - Backup to Google Drive anytime
3. **Delete** - Clear all data from extension settings
4. **Uninstall** - Removing the extension deletes all local data

## Open Source

This extension is **100% open source**. You can:
- Review the source code
- Verify our privacy claims
- Contribute improvements
- Fork and modify for your needs

**Repository:** [GitHub URL]

## Children's Privacy

This extension does not knowingly collect data from children under 13. It is designed for general productivity use.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be noted with an updated "Last updated" date.

## Contact

For privacy questions or concerns:
- Open an issue on GitHub
- Email: [Your email if you want to provide one]

---

**Summary:** Focus Timer stores all data locally on your device. Optional Google Drive backup goes to your own account. We don't collect, share, or sell any personal data. The code is open source for full transparency.
