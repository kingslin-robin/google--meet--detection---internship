// WORKING CODE 
let userPermissionGranted = false;
let currentRecordingTab = null;

// Load saved permission state
chrome.storage.local.get(['autoRecordPermission'], (result) => {
  userPermissionGranted = result.autoRecordPermission || false;
  console.log("🔐 Auto record permission:", userPermissionGranted);
});

// Listen for Meet tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isMeetTab(tab.url)) {
    console.log("✅ Meet tab detected:", tabId, tab.url);
  }
});

function isMeetTab(url) {
  return url && (url.includes("meet.google.com/"));
}

// Listen for messages from popup/content
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message.action);
  
  if (message.action === "grantAutoRecordPermission") {
    userPermissionGranted = true;
    chrome.storage.local.set({ autoRecordPermission: true }, () => notifyAllMeetTabs(true));
    sendResponse({ success: true });
  }
  
  if (message.action === "revokeAutoRecordPermission") {
    userPermissionGranted = false;
    chrome.storage.local.set({ autoRecordPermission: false }, () => notifyAllMeetTabs(false));
    sendResponse({ success: true });
  }
  
  if (message.action === "autoStartRecording") {
    if (userPermissionGranted) startRecordingForTab(sender.tab.id);
    sendResponse({ success: true });
  }

  if (message.action === "autoStopRecording") {
    stopAllRecordings();
    sendResponse({ success: true });
  }
  
  if (message.action === "checkMeetingStatus") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "checkMeetingStatus" }, sendResponse);
    return true;
  }

  // Close recorder tab for auto mode
  if (message.action === "closeRecorderTab") {
    console.log("🛑 Closing recorder tab for auto mode");
    closeAllRecorderTabs();
    sendResponse({ success: true });
  }

  // Stop recording when meeting ends (both modes)
  if (message.action === "stopRecordingOnMeetingEnd") {
    console.log("🛑 Meeting ended - stopping recording");
    stopAllRecordings();
    sendResponse({ success: true });
  }

  return true;
});

// Close all recorder tabs
function closeAllRecorderTabs() {
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    tabs.forEach(tab => {
      // Just send stop message, recorder will close itself after download
      chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });
      console.log("✅ Stop message sent to recorder tab");
    });
  });
  currentRecordingTab = null;
}

// Notify all Meet tabs about permission change
function notifyAllMeetTabs(enabled) {
  chrome.tabs.query({ url: ["https://*.meet.google.com/*"] }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "updateAutoRecordPermission",
        enabled: enabled
      });
    });
  });
}

function startRecordingForTab(tabId) {
  if (currentRecordingTab) return;

  chrome.tabs.create({ url: chrome.runtime.getURL("recorder.html"), active: false }, (recorderTab) => {
    const attemptStart = (retry = 0) => {
      chrome.tabs.sendMessage(recorderTab.id, { action: "startRecording", tabId, autoRecord: true }, (resp) => {
        if (chrome.runtime.lastError) {
          if (retry < 2) setTimeout(() => attemptStart(retry + 1), 1000);
          else console.error("❌ Failed to start recording");
        } else currentRecordingTab = tabId;
      });
    };
    setTimeout(() => attemptStart(), 1500);
  });
}

function stopAllRecordings() {
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    if (tabs.length > 0) {
      tabs.forEach(tab => {
        // 🆕 SEND STOP MESSAGE TO RECORDER TAB
        chrome.tabs.sendMessage(tab.id, { action: "stopRecording" }, (response) => {
          if (chrome.runtime.lastError) {
            console.log("⚠️ Recorder tab not responding, might be already closed");
          } else {
            console.log("✅ Stop message sent to recorder tab");
          }
        });
      });
    } else {
      console.log("⚠️ No recorder tabs found");
    }
  });
  currentRecordingTab = null;
}

// Stop recording if source tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentRecordingTab) stopAllRecordings();
});

// Keep service worker alive
setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);


