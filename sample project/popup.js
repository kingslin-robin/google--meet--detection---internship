// POPUP - RESOLVED ASYNC ERRORS
let activeTabId;
let isRecording = false;
let autoRecordEnabled = false;

// Check current tab on popup open
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🔍 Popup opened - checking tab...");

  try {
    await checkForFailedRecorders();
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url && isMeetTab(tab.url)) {
      activeTabId = tab.id;
      console.log("✅ Google Meet tab detected:", activeTabId);

      // Proper async message handling
      chrome.tabs.sendMessage(activeTabId, { action: "checkMeetingStatus" }, (response) => {
        if (chrome.runtime.lastError) {
          console.log("⚠️ Could not check meeting status:", chrome.runtime.lastError.message);
        } else if (response) {
          updateMeetingStatusUI(response.isInMeeting, response.recording);
        }
      });
    }

    // Check current recording status and permission
    await checkRecordingStatus();
    await checkAutoRecordPermission();

    await verifyRecorderTabStatus();

    startUISyncChecker();
    
  } catch (error) {
    console.error("❌ Error checking tab:", error);
  }
});

function isMeetTab(url) {
  return url && url.includes("meet.google.com");
}

// UI UPDATE
function updateMeetingStatusUI(isInMeeting, isRecordingFlag) {
  const statusElement = document.getElementById("status");

  if (isInMeeting) {
    statusElement.textContent = isRecordingFlag ? "🟢 In Meet - Recording..." : "🟡 In Meet - Ready to Record";
    statusElement.style.color = isRecordingFlag ? "#f3f0ecff" : "#f3f0ecff";
  } else {
    statusElement.textContent = "⚪ Not in Meeting";
    statusElement.style.color = "#f3f0ecff";
  }
}

function updateUIForRecording(recordingTime) {
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = autoRecordEnabled;
  document.getElementById("timer").textContent = recordingTime;
  document.getElementById("status").textContent = "🟢 Recording in background...";
  document.getElementById("startBtn").textContent = "Recording...";
  document.getElementById("startBtn").style.backgroundColor = "#666";
  document.getElementById("stopBtn").style.backgroundColor = autoRecordEnabled ? "#666" : "#f44336";
}

function updateUIForReady() {
  // Disable buttons if auto-record is enabled
  const startDisabled = !activeTabId || autoRecordEnabled;
  const stopDisabled = true || autoRecordEnabled; // Always disabled when not recording OR auto-record enabled
  
  document.getElementById("startBtn").disabled = startDisabled;
  document.getElementById("stopBtn").disabled = stopDisabled;
  document.getElementById("timer").textContent = "00:00";

  if (activeTabId) {
    document.getElementById("status").textContent = autoRecordEnabled ? "✅ Auto Record Enabled" : "✅ Ready to record";
  } else {
    document.getElementById("status").textContent = "❌ Please open Google Meet";
  }

  document.getElementById("startBtn").textContent = "Start Recording";
  document.getElementById("startBtn").style.backgroundColor = startDisabled ? "#666" : "#4CAF50";
  document.getElementById("stopBtn").style.backgroundColor = stopDisabled ? "#666" : "#f44336"  ;
}

async function checkForFailedRecorders() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "cleanupFailedRecorders" });
    if (response?.success) {
      console.log("✅ Manual cleanup completed");
    }
  } catch (error) {
    console.log("✅ No failed recorders found");
  }
}

// AUTO RECORD PERMISSION
async function checkAutoRecordPermission() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoRecordPermission'], (result) => {
      autoRecordEnabled = result.autoRecordPermission || false;
      
      console.log("🔄 DEBUG - Storage value:", result.autoRecordPermission);
      console.log("🔄 DEBUG - autoRecordEnabled:", autoRecordEnabled);

      updateToggleUI();
      resolve(autoRecordEnabled);
    });
  });
}

function updateToggleUI() {
  const toggle = document.getElementById('autoRecordToggle');
  const label = document.getElementById('toggleLabel');
  const permissionText = document.getElementById('permissionText');
  
  console.log("🔄 DEBUG - updateToggleUI called, autoRecordEnabled:", autoRecordEnabled);
  console.log("🔄 DEBUG - Elements found - toggle:", !!toggle, "label:", !!label, "permissionText:", !!permissionText);
  
  if (toggle) {
    toggle.checked = autoRecordEnabled;
    console.log("✅ Toggle set to:", autoRecordEnabled);
  }
  if (label) {
    label.textContent = autoRecordEnabled ? 'ON' : 'OFF';
    label.style.color = autoRecordEnabled ? '#edf0edff' : '#edf0edff';
    label.style.fontWeight = 'bold';
    console.log("✅ Label set to:", label.textContent);
  }
  if (permissionText) {
    permissionText.textContent = autoRecordEnabled 
      ? 'Auto recording enabled - meetings will be recorded automatically' 
      : 'Manually record when joining meetings';
    permissionText.style.color = autoRecordEnabled ? '#edf0edff' : '#edf0edff';
    console.log("✅ Permission text updated");
  }

  // ADD THIS: Disable both buttons when auto-record is enabled
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  
  if (startBtn) {
    startBtn.disabled = autoRecordEnabled;
    startBtn.style.backgroundColor = autoRecordEnabled ? '#666' : (activeTabId ? '#4CAF50' : '#666');
  }
  
  if (stopBtn) {
    stopBtn.disabled = autoRecordEnabled || !isRecording;
    stopBtn.style.backgroundColor = autoRecordEnabled ? '#666' : (isRecording ? '#f44336' : '#666');
  }
}

// Proper async storage change handling
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.autoRecordPermission) {
    console.log("🔄 Storage change detected for autoRecordPermission:", changes.autoRecordPermission.newValue);
    autoRecordEnabled = changes.autoRecordPermission.newValue;
    
    // Force UI update with small delay to ensure DOM is ready
    setTimeout(() => {
      updateToggleUI();
    }, 100);
    
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) {
      stopBtn.disabled = isRecording && autoRecordEnabled;
      stopBtn.style.backgroundColor = (isRecording && autoRecordEnabled) ? "#666" : "#f44336";
    }
  }
});

// Function to close all recorder tabs
async function closeAllRecorderTabs() {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
            if (tabs.length === 0) {
                console.log("✅ No recorder tabs to close");
                resolve();
                return;
            }
            
            let closedCount = 0;
            tabs.forEach(tab => {
                chrome.tabs.remove(tab.id, () => {
                    closedCount++;
                    console.log(`✅ Closed recorder tab: ${tab.id}`);
                    
                    if (closedCount === tabs.length) {
                        console.log("✅ All recorder tabs closed");
                        resolve();
                    }
                });
            });
        });
    });
}


// Async toggle handler - WITH IMMEDIATE UI FEEDBACK
document.getElementById('autoRecordToggle').addEventListener('change', async (e) => {
  const enabled = e.target.checked;

  if (enabled) {
    const confirmed = confirm("Enable Auto Recording?\n\nAutomatically start recording when you join Meet and stop when you leave.\n\nRecording will start 3 seconds after joining a meeting.");
    if (!confirmed) {
      e.target.checked = false;
      updateToggleUI(); // Immediate UI update
      return;
    }
  }

  // Update UI immediately for better UX
  autoRecordEnabled = enabled;
  updateToggleUI();

  try {
    const action = enabled ? "grantAutoRecordPermission" : "revokeAutoRecordPermission";
    await chrome.runtime.sendMessage({ action: action });
  } catch (error) {
    console.error("❌ Error toggling permission:", error);
    // Revert on error
    autoRecordEnabled = !enabled;
    updateToggleUI();
  }
});

// Recording status
async function checkRecordingStatus() {
  const result = await chrome.storage.local.get(['isRecording', 'recordingTime']);
  isRecording = result.isRecording || false;

  if (result.recordingStoppedByTabClose) {
    console.log("🔄 Recording was stopped by tab closure - resetting UI");
    isRecording = false;
    chrome.storage.local.remove(['recordingStoppedByTabClose']);
  }

  if (isRecording) {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
    if (tabs.length === 0) {
      console.log("🔄 No recorder tabs found but storage says recording - resetting UI");
      isRecording = false;
      chrome.storage.local.set({ isRecording: false });
      updateUIForReady();
    } else {
      updateUIForRecording(result.recordingTime || "00:00");
      await verifyRecorderTabStatus();
    }
  } else {
    updateUIForReady();
  }
}

// Start Recording with proper error handling
document.getElementById("startBtn").addEventListener("click", async () => {
  if (!activeTabId) return alert("❌ Please open Google Meet first");

  document.getElementById("startBtn").disabled = true;
  document.getElementById("startBtn").textContent = "Starting...";
  document.getElementById("status").textContent = "🟡 Starting recording...";

  try {
    // Use proper async messaging
    chrome.tabs.sendMessage(activeTabId, { action: "manualRecordingStarted" }, (response) => {
      if (chrome.runtime.lastError) {
        console.log("⚠️ Could not notify content script:", chrome.runtime.lastError.message);
      }
    });

    chrome.tabs.create({ url: chrome.runtime.getURL("recorder.html"), active: false }, (tab) => {
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: "startRecording", tabId: activeTabId }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("❌ Failed to start recording:", chrome.runtime.lastError.message);
            document.getElementById("status").textContent = "❌ Failed to start recording";
            updateUIForReady();
          }
        });
      }, 1000);
    });
  } catch (error) {
    console.error("❌ Error starting recording:", error);
    document.getElementById("status").textContent = "❌ Error starting recording";
    updateUIForReady();
  }
});

// Stop Recording with proper error handling
document.getElementById("stopBtn").addEventListener("click", async () => {
  if (activeTabId) {
    try {
      chrome.tabs.sendMessage(activeTabId, { action: "manualRecordingStopped" }, (response) => {
        if (chrome.runtime.lastError) {
          console.log("⚠️ Could not notify content script:", chrome.runtime.lastError.message);
        }
      });
    } catch (error) {
      console.log("⚠️ Error notifying content script:", error);
    }
  }
  stopRecordingAndDownload();
});

// HELPER: Stop + Download
async function stopRecordingAndDownload() {
  document.getElementById("stopBtn").disabled = true;
  document.getElementById("stopBtn").textContent = "Stopping...";
  document.getElementById("status").textContent = "🟡 Stopping recording...";

  try {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "stopRecording" }, (response) => {
        if (chrome.runtime.lastError) {
          console.log("⚠️ Recorder tab not responding:", chrome.runtime.lastError.message);
        }
      });
    } else {
      await chrome.storage.local.remove(['isRecording', 'recordingTime','recordingStoppedByTabClose']);
      isRecording = false;
      updateUIForReady();
    }
  } catch (error) {
    console.error("❌ Error stopping recording:", error);
    await chrome.storage.local.remove(['isRecording', 'recordingTime','recordingStoppedByTabClose']);
    isRecording = false;
    updateUIForReady();
  }
}

function startUISyncChecker() {
  setInterval(async () => {
    if (isRecording) {
      // If we think we're recording but no recorder tabs exist, reset UI
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
      if (tabs.length === 0) {
        console.log("🔄 UI Sync: No recorder tabs but recording flag true - resetting");
        isRecording = false;
        updateUIForReady();
        chrome.storage.local.set({ isRecording: false });
      }
    }
  }, 3000); // Check every 3 seconds
}

// Check if recorder tab is actually working
async function verifyRecorderTabStatus() {
  try {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
    if (tabs.length > 0) {
      // Send a status check to recorder tab
      chrome.tabs.sendMessage(tabs[0].id, { action: "checkRecorderStatus" }, (response) => {
        if (chrome.runtime.lastError || !response || response.status !== "recording") {
          console.log("🔄 Recorder tab not properly recording - resetting UI");
          isRecording = false;
          updateUIForReady();
          chrome.storage.local.set({ isRecording: false });
        }
      });
    } else {
      // No recorder tabs found - ensure UI is reset
      console.log("🔄 No recorder tabs found - ensuring UI is reset");
      isRecording = false;
      updateUIForReady();
      chrome.storage.local.set({ isRecording: false });
    }
  } catch (error) {
    console.log("⚠️ Error verifying recorder tab:", error);
  }
}

// Proper message listener with error handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.action === "timerUpdate") {
      document.getElementById("timer").textContent = message.time;
    }
    else if (message.action === "recordingStarted") {
      isRecording = true;
      updateUIForRecording("00:00");
    }
    else if (message.action === "recordingStopped") {
      isRecording = false;
      updateUIForReady();
    
      // Ensure recorder tabs are closed
      setTimeout(() => {
        closeAllRecorderTabs();
      }, 1000);
    }
    else if (message.action === "autoStopRecording") {
      stopRecordingAndDownload();
    }

    else if (message.action === "recordingCompleted") {
      console.log("✅ Popup: Recording completed - resetting UI");
      isRecording = false;
      updateUIForReady();
      
      // Ensure recorder tabs are closed
      setTimeout(() => {
        closeAllRecorderTabs();
      }, 1000);
    }

    else if (message.action === "recorderFailed") {
      console.error("❌ Recorder reported failure:", message.error);
      isRecording = false;
      document.getElementById("status").textContent = "❌ Recording Failed: " + message.error;
      document.getElementById("status").style.color = "#f44336";
      document.getElementById("startBtn").disabled = false;
      document.getElementById("startBtn").textContent = "Start Recording";
      document.getElementById("startBtn").style.backgroundColor = "#4CAF50";
      document.getElementById("stopBtn").disabled = true;
      document.getElementById("stopBtn").style.backgroundColor = "#666";
      
      // Clear storage to reflect actual state
      chrome.storage.local.set({ isRecording: false });
    }
    
    sendResponse({ success: true });
  } catch (error) {
    console.error("❌ Error handling message:", error);
    sendResponse({ success: false, error: error.message });
  }
  
  return true; 
});

// Popup tooltip
document.addEventListener('DOMContentLoaded', () => {
  const toggleContainer = document.querySelector('.permission-toggle');
  toggleContainer.title = "Automatically start/stop recording when joining/leaving Google Meet calls";
  document.getElementById('startBtn').title = "Manually start recording current Meet tab";
  document.getElementById('stopBtn').title = "Stop recording and download the video";
});
