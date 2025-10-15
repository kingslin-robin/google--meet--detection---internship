// FIXED POPUP - RESOLVED ASYNC ERRORS
let activeTabId;
let isRecording = false;
let autoRecordEnabled = false;

// Check current tab on popup open
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🔍 Popup opened - checking tab...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url && isMeetTab(tab.url)) {
      activeTabId = tab.id;
      console.log("✅ Google Meet tab detected:", activeTabId);

      // 🆕 FIXED: Proper async message handling
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
    statusElement.style.color = isRecordingFlag ? "#4CAF50" : "#FF9800";
  } else {
    statusElement.textContent = "⚪ Not in Meeting";
    statusElement.style.color = "#9E9E9E";
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
  document.getElementById("startBtn").disabled = !activeTabId;
  document.getElementById("stopBtn").disabled = true;
  document.getElementById("timer").textContent = "00:00";

  if (activeTabId) {
    document.getElementById("status").textContent = "✅ Ready to record";
  } else {
    document.getElementById("status").textContent = "❌ Please open Google Meet";
  }

  document.getElementById("startBtn").textContent = "Start Recording";
  document.getElementById("startBtn").style.backgroundColor = activeTabId ? "#4CAF50" : "#666";
  document.getElementById("stopBtn").style.backgroundColor = "#666";
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
  
  console.log("🔄 DEBUG - Updating toggle UI to:", autoRecordEnabled);
  
  if (toggle) {
    toggle.checked = autoRecordEnabled;
  }
  if (label) {
    label.textContent = autoRecordEnabled ? 'ON' : 'OFF';
    label.style.color = autoRecordEnabled ? '#4CAF50' : '#f44336';
    label.style.fontWeight = 'bold';
  }
  if (permissionText) {
    permissionText.textContent = autoRecordEnabled 
      ? 'Auto recording enabled - meetings will be recorded automatically' 
      : 'Manually record when joining meetings';
    permissionText.style.color = autoRecordEnabled ? '#4CAF50' : '#f44336';
  }
}

// 🆕 FIXED: Proper async storage change handling
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.autoRecordPermission) {
    console.log("🔄 Storage change detected for autoRecordPermission:", changes.autoRecordPermission.newValue);
    autoRecordEnabled = changes.autoRecordPermission.newValue;
    updateToggleUI();
    
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn && isRecording) {
      stopBtn.disabled = autoRecordEnabled;
      stopBtn.style.backgroundColor = autoRecordEnabled ? "#666" : "#f44336";
    }
  }
});

// 🆕 FIXED: Async toggle handler
document.getElementById('autoRecordToggle').addEventListener('change', async (e) => {
  const enabled = e.target.checked;

  if (enabled) {
    const confirmed = confirm("Enable Auto Recording?\n\nAutomatically start recording when you join Meet and stop when you leave.\n\nRecording will start 3 seconds after joining a meeting.");
    if (confirmed) {
      try {
        await chrome.runtime.sendMessage({ action: "grantAutoRecordPermission" });
        autoRecordEnabled = true;
      } catch (error) {
        console.error("❌ Error granting permission:", error);
        e.target.checked = false;
        updateToggleUI();
        return;
      }
    } else { 
      e.target.checked = false; 
      updateToggleUI();
      return; 
    }
    
    document.getElementById('stopBtn').disabled = true;
    document.getElementById('stopBtn').style.backgroundColor = "#666";

  } else {
    try {
      await chrome.runtime.sendMessage({ action: "revokeAutoRecordPermission" });
      autoRecordEnabled = false;
    } catch (error) {
      console.error("❌ Error revoking permission:", error);
      e.target.checked = true;
      updateToggleUI();
      return;
    }

    document.getElementById('stopBtn').disabled = false;
    document.getElementById('stopBtn').style.backgroundColor = "#f44336";
  }
  
  updateToggleUI();
  updateUIForReady();
});

// RECORDING
async function checkRecordingStatus() {
  const result = await chrome.storage.local.get(['isRecording', 'recordingTime']);
  isRecording = result.isRecording || false;

  if (result.recordingStoppedByTabClose) {
    console.log("🔄 Recording was stopped by tab closure - resetting UI");
    isRecording = false;
    chrome.storage.local.remove(['recordingStoppedByTabClose']);
  }

  if (isRecording) updateUIForRecording(result.recordingTime || "00:00");
  else updateUIForReady();
}

// 🆕 FIXED: Start Recording with proper error handling
document.getElementById("startBtn").addEventListener("click", async () => {
  if (!activeTabId) return alert("❌ Please open Google Meet first");

  document.getElementById("startBtn").disabled = true;
  document.getElementById("startBtn").textContent = "Starting...";
  document.getElementById("status").textContent = "🟡 Starting recording...";

  try {
    // 🆕 FIXED: Use proper async messaging
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

// 🆕 FIXED: Stop Recording with proper error handling
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

// 🆕 FIXED: Proper message listener with error handling
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
    }
    else if (message.action === "autoStopRecording") {
      stopRecordingAndDownload();
    }
    
    sendResponse({ success: true });
  } catch (error) {
    console.error("❌ Error handling message:", error);
    sendResponse({ success: false, error: error.message });
  }
  
  return true; // 🆕 Keep message channel open for async response
});

// POPUP TOOLTIP
document.addEventListener('DOMContentLoaded', () => {
  const toggleContainer = document.querySelector('.permission-toggle');
  toggleContainer.title = "Automatically start/stop recording when joining/leaving Google Meet calls";
  document.getElementById('startBtn').title = "Manually start recording current Meet tab";
  document.getElementById('stopBtn').title = "Stop recording and download the video";
});
