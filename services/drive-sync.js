/**
 * Focus Timer - Google Drive Sync Service
 * Handles backup/restore to Google Drive appData folder
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const BACKUP_FILENAME = 'focus-timer-backup.json';

/**
 * Get OAuth2 token using Chrome Identity API
 * @param {boolean} interactive - Show login popup if needed
 * @returns {Promise<string|null>} Access token or null
 */
async function getAuthToken(interactive = false) {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        console.log('Auth error:', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * Remove cached auth token (for logout/re-auth)
 * @param {string} token
 */
async function removeAuthToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

/**
 * Check if user is connected to Google Drive
 * @returns {Promise<boolean>}
 */
async function isDriveConnected() {
  const token = await getAuthToken(false);
  return !!token;
}

/**
 * Connect to Google Drive (interactive login)
 * @returns {Promise<boolean>} Success
 */
async function connectDrive() {
  const token = await getAuthToken(true);
  return !!token;
}

/**
 * Disconnect from Google Drive
 */
async function disconnectDrive() {
  const token = await getAuthToken(false);
  if (token) {
    await removeAuthToken(token);
    // Revoke token on Google's side
    try {
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
    } catch (e) {
      console.log('Revoke error:', e);
    }
  }
}

/**
 * Find backup file in appData folder
 * @param {string} token
 * @returns {Promise<string|null>} File ID or null
 */
async function findBackupFile(token) {
  const query = encodeURIComponent(`name='${BACKUP_FILENAME}' and 'appDataFolder' in parents and trashed=false`);
  const url = `${DRIVE_API}/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) return null;

  const data = await response.json();
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

/**
 * Upload backup to Google Drive
 * @returns {Promise<{success: boolean, error?: string, lastSync?: number}>}
 */
async function uploadBackup() {
  const token = await getAuthToken(false);
  if (!token) {
    return { success: false, error: 'Not connected to Google Drive' };
  }

  try {
    // Get all data to backup (from both sync and local storage)
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get(null)
    ]);
    // Remove internal Chrome keys
    delete localData.lastDriveSync;

    const backup = {
      version: 2,  // Version 2 uses split storage
      timestamp: Date.now(),
      syncData: syncData,   // settings, reminders, streaks
      localData: localData  // domains, history, habitTracker
    };

    // Check if file exists
    const existingFile = await findBackupFile(token);

    let response;
    const metadata = {
      name: BACKUP_FILENAME,
      mimeType: 'application/json'
    };

    if (existingFile) {
      // Update existing file
      response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/related; boundary=foo_bar_baz'
        },
        body: createMultipartBody(metadata, JSON.stringify(backup, null, 2))
      });
    } else {
      // Create new file in appDataFolder
      metadata.parents = ['appDataFolder'];
      response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/related; boundary=foo_bar_baz'
        },
        body: createMultipartBody(metadata, JSON.stringify(backup, null, 2))
      });
    }

    if (!response.ok) {
      const error = await response.text();
      console.error('Upload failed:', error);
      return { success: false, error: 'Upload failed' };
    }

    // Save last sync time
    await chrome.storage.local.set({ lastDriveSync: Date.now() });

    return { success: true, lastSync: Date.now() };
  } catch (e) {
    console.error('Backup error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Download and restore backup from Google Drive
 * @returns {Promise<{success: boolean, error?: string, lastSync?: number}>}
 */
async function downloadBackup() {
  const token = await getAuthToken(false);
  if (!token) {
    return { success: false, error: 'Not connected to Google Drive' };
  }

  try {
    const file = await findBackupFile(token);
    if (!file) {
      return { success: false, error: 'No backup found' };
    }

    // Download file content
    const response = await fetch(`${DRIVE_API}/files/${file.id}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      return { success: false, error: 'Download failed' };
    }

    const backup = await response.json();

    // Validate backup structure
    if (!backup.version) {
      return { success: false, error: 'Invalid backup format' };
    }

    // Restore data - handle both v1 and v2 formats
    if (backup.version === 2) {
      // Version 2: Split storage
      await Promise.all([
        chrome.storage.sync.clear(),
        chrome.storage.local.clear()
      ]);
      await Promise.all([
        chrome.storage.sync.set(backup.syncData || {}),
        chrome.storage.local.set(backup.localData || {})
      ]);
    } else {
      // Version 1: All data in sync (legacy)
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(backup.data || {});
    }
    await chrome.storage.local.set({ lastDriveSync: Date.now() });

    return { success: true, lastSync: backup.timestamp };
  } catch (e) {
    console.error('Restore error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Get sync status
 * @returns {Promise<{connected: boolean, lastSync: number|null, backupExists: boolean, backupTime: number|null}>}
 */
async function getSyncStatus() {
  const token = await getAuthToken(false);
  const localData = await chrome.storage.local.get('lastDriveSync');

  if (!token) {
    return {
      connected: false,
      lastSync: localData.lastDriveSync || null,
      backupExists: false,
      backupTime: null
    };
  }

  const file = await findBackupFile(token);

  return {
    connected: true,
    lastSync: localData.lastDriveSync || null,
    backupExists: !!file,
    backupTime: file ? new Date(file.modifiedTime).getTime() : null
  };
}

/**
 * Create multipart body for Drive API upload
 */
function createMultipartBody(metadata, content) {
  const boundary = 'foo_bar_baz';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  return delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    content +
    closeDelimiter;
}

// Export functions for use in service worker
if (typeof self !== 'undefined') {
  self.DriveSync = {
    getAuthToken,
    isDriveConnected,
    connectDrive,
    disconnectDrive,
    uploadBackup,
    downloadBackup,
    getSyncStatus
  };
}
