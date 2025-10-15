// FIXED AUTO RECORDING CODE
let isInMeeting = false;
let recordingStarted = false;
let autoRecordEnabled = false;
let leaveButtonObserver = null;
let lastLeaveButtonVisible = false;

// Meeting Detection + Timer + Duration
let timerEl = null;
let timerInterval = null;
let recordStartTime = null;
let meetingStarted = false;
let meetingStartTime = null;
let meetingEndTime = null;
let totalMeetingDuration = 0;

// DURATION CALCULATION
function startMeetingTimer() {
    meetingStartTime = Date.now();
    console.log(`%c📅 Meeting started at : ${new Date(meetingStartTime).toLocaleTimeString()}`,"color: #0f9d58; font-weight: bold;");
}

function stopMeetingTimer() {
    if (meetingStartTime) {
        meetingEndTime = Date.now();
        totalMeetingDuration = Math.floor((meetingEndTime - meetingStartTime) / 1000);
        
        const minutes = Math.floor(totalMeetingDuration / 60);
        const seconds = totalMeetingDuration % 60;

        console.log(`%c📅 Meeting ended at : ${new Date(meetingEndTime).toLocaleTimeString()}`, "color: #d93025; font-weight: bold;");
        console.log(`%c⏱️ Duration of meeting : ${minutes}m ${seconds}s`, "color: #f4b400; font-weight: bold;");

        chrome.storage.local.set({
            lastMeetingDuration: totalMeetingDuration,
            lastMeetingEndTime: meetingEndTime
        });
        
        meetingStartTime = null;
        meetingEndTime = null;
    }
}

function getCurrentMeetingDuration() {
    if (meetingStartTime) {
        const currentDuration = Math.floor((Date.now() - meetingStartTime) / 1000);
        const minutes = Math.floor(currentDuration / 60);
        const seconds = currentDuration % 60;
        return `${minutes}m ${seconds}s`;
    }
    return "0m 0s";
}

// Check if meeting is active
function isMeetingActive() {
  return document.querySelector('[aria-label^="Leave call"], [aria-label^="Leave meeting"]');
}

// Check Auto Record Permission
async function checkAutoRecordPermission() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoRecordPermission'], (result) => {
      autoRecordEnabled = result.autoRecordPermission || false;
      console.log("🔐 Auto record enabled:", autoRecordEnabled);
      resolve(autoRecordEnabled);
    });
  });
}

// Detect Leave Button
function findLeaveButton() {
  const selectors = [
    'button[aria-label="Leave call"]',
    'button[aria-label*="Leave call"]',
    'div[role="button"][data-tooltip="Leave call"]',
    'div[role="button"][aria-label*="Leave"]',
    'button[jscontroller][jsname][aria-label*="Leave"]',
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function isElementVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' &&
         style.visibility !== 'hidden' &&
         style.opacity !== '0' &&
         rect.width > 0 &&
         rect.height > 0 &&
         element.offsetParent !== null;
}

// Check Meeting State - FIXED AUTO RECORDING
function checkMeetingState() {
  const leaveButton = findLeaveButton();
  const leaveVisible = leaveButton && isElementVisible(leaveButton);

  // Meeting joined
  if (leaveVisible && !lastLeaveButtonVisible) {
    console.log("✅ Leave button visible - Meeting joined");
    isInMeeting = true;
    meetingStarted = true;
    startMeetingTimer();
    
    // 🆕 FIXED: Auto recording with proper 2-3 second delay
    if (autoRecordEnabled && !recordingStarted) {
      console.log("🔄 Auto-record enabled - starting recording in 3 seconds...");
      showMeetStatus("🟡 Auto recording starting in 3 seconds...");
      
      setTimeout(async () => {
        if (isInMeeting && autoRecordEnabled && !recordingStarted) {
          console.log("🚀 Starting auto recording now...");
          await startAutoRecording();
        }
      }, 3000); // 3 second delay
    }
  }

  // Meeting ended
  if (!leaveVisible && lastLeaveButtonVisible) {
    console.log("❌ Leave button hidden - Meeting ended");
    isInMeeting = false;
    meetingStarted = false;
    stopMeetingTimer();
    
    chrome.storage.local.get(['isRecording'], (result) => {
      if (result.isRecording) {
        console.log("🛑 Meeting ended - stopping recording");
        chrome.runtime.sendMessage({ action: "stopRecordingOnMeetingEnd" });
      }
    });
  }

  lastLeaveButtonVisible = leaveVisible;
  chrome.storage.local.set({ isInMeeting });
}

// Start / Stop Auto Recording - FIXED
async function startAutoRecording() {
  if (recordingStarted) {
    console.log("⚠️ Auto recording already started, skipping");
    return;
  }
  
  console.log("🚀 Starting auto recording...");
  showMeetStatus("🟡 Starting auto recording...");
  
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "autoStartRecording" }, resolve);
    });
    
    if (response?.success) {
      recordingStarted = true;
      console.log("✅ Auto recording started successfully");
      showMeetStatus("🔴 Auto Recording Started");
      
      // Update storage to reflect recording state
      chrome.storage.local.set({ isRecording: true });
    } else {
      console.log("❌ Failed to start auto recording:", response);
      recordingStarted = false;
      showMeetStatus("❌ Auto Recording Failed");
    }
  } catch (error) {
    console.log("❌ Error starting auto recording:", error);
    recordingStarted = false;
    showMeetStatus("❌ Auto Recording Error");
  }
}

function stopAutoRecording() {
  if (!recordingStarted) return;
  recordingStarted = false;

  chrome.runtime.sendMessage({ action: "autoStopRecording" }, (response) => {
    if (response?.success) {
      console.log("✅ Auto recording stopped");
      if (autoRecordEnabled) {
        chrome.runtime.sendMessage({ action: "closeRecorderTab" });
      }
    } else {
      console.log("❌ Failed to stop auto recording");
    }
  });
}

// Observe DOM Changes
function setupLeaveButtonObserver() {
  if (leaveButtonObserver) leaveButtonObserver.disconnect();
  leaveButtonObserver = new MutationObserver(() => {
    setTimeout(checkMeetingState, 500);
  });
  leaveButtonObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'aria-hidden', 'disabled']
  });
}

// MEET UI STATUS DISPLAY
function showMeetStatus(message) {
    const existing = document.getElementById('meet-recorder-status');
    if (existing) existing.remove();
    
    const status = document.createElement('div');
    status.id = 'meet-recorder-status';
    status.textContent = message;
    status.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 10px 15px;
        border-radius: 8px;
        font-family: Arial;
        font-size: 14px;
        z-index: 10000;
        font-weight: bold;
    `;
    
    document.body.appendChild(status);

    if (message.includes("Recording started") || message.includes("Recording saved") || message.includes("Recording failed")) {
        setTimeout(() => {
            const currentStatus = document.getElementById('meet-recorder-status');
            if (currentStatus && currentStatus.textContent === message) {
                currentStatus.remove();
            }
        }, 3000);
    }
}

// Listen for Messages from Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateAutoRecordPermission") {
    autoRecordEnabled = message.enabled;
    console.log("🔄 Auto record permission updated:", autoRecordEnabled);
    
    if (autoRecordEnabled && isInMeeting && !recordingStarted) {
      console.log("🔄 Auto record enabled while in meeting - starting recording");
      setTimeout(startAutoRecording, 2000);
    }
    sendResponse({ success: true });
  }

  if (message.action === "checkMeetingStatus") {
    sendResponse({ 
      isInMeeting, 
      recording: recordingStarted, 
      autoRecordEnabled,
      meetingDuration: getCurrentMeetingDuration()
    });
  }

  if (message.action === "autoStopRecording") {
    stopAutoRecording();
    sendResponse({ success: true });
  }

  if (message.action === "getMeetingDuration") {
    const duration = getCurrentMeetingDuration();
    sendResponse({ 
      duration: duration,
      isInMeeting: isInMeeting,
      startTime: meetingStartTime
    });
  }

  if (message.action === "getLastMeetingStats") {
    chrome.storage.local.get(['lastMeetingDuration', 'lastMeetingEndTime'], (result) => {
      sendResponse({
        lastDuration: result.lastMeetingDuration || 0,
        lastEndTime: result.lastMeetingEndTime || null
      });
    });
    return true;
  }

  if (message.action === "getMuteStatus") {
    const status = getMuteStatus();
    sendResponse(status);
  }

  if (message.action === "showMeetStatus") {
    showMeetStatus(message.message);
    sendResponse({ success: true });
  }
  
  if (message.action === "updateMeetTimer") {
    const status = document.getElementById('meet-recorder-status');
    if (status && status.textContent.includes('Recording')) {
      status.textContent = `🔴 Recording... ${message.time}`;
    }
  }
  
  return true;
});

// Initial Setup
setTimeout(async () => {
  await checkAutoRecordPermission();
  setupLeaveButtonObserver();
  setInterval(checkMeetingState, 2000);
  
  setTimeout(() => {
    console.log("🔍 Initial meeting state check...");
    checkMeetingState();
    checkInitialMeetingState();

    console.log("📊 Initial state:", {
      autoRecordEnabled,
      isInMeeting, 
      recordingStarted,
      leaveButtonVisible: lastLeaveButtonVisible
    });
  }, 1500);
  
  console.log("🔍 Meet Auto Recorder content script fully loaded");
}, 1000);

// Check if already in meeting when script loads
function checkInitialMeetingState() {
  const leaveButton = findLeaveButton();
  const leaveVisible = leaveButton && isElementVisible(leaveButton);
  
  if (leaveVisible && !isInMeeting) {
    console.log("🔍 Already in meeting - will auto-start recording in 3 seconds");
    isInMeeting = true;
    meetingStarted = true;
    startMeetingTimer();
    
    if (autoRecordEnabled && !recordingStarted) {
      console.log("🚀 Auto-starting recording for existing meeting");
      showMeetStatus("🟡 Auto recording starting in 3 seconds...");
      setTimeout(async () => {
        await startAutoRecording();
      }, 3000);
    }
  }
}

// Mute status detection
function getMuteStatus() {
  const muteButton = document.querySelector('[aria-label*="microphone"]') || 
                     document.querySelector('[data-tooltip*="microphone"]') ||
                     document.querySelector('[jscontroller*="microphone"]');
  
  if (muteButton) {
    const ariaLabel = muteButton.getAttribute('aria-label') || '';
    const isMuted = ariaLabel.includes('unmute') || ariaLabel.includes('Turn on');
    return { isMuted: isMuted };
  }
  
  const muteIcon = document.querySelector('svg[aria-label*="microphone"]');
  if (muteIcon) {
    const ariaLabel = muteIcon.getAttribute('aria-label') || '';
    const isMuted = ariaLabel.includes('unmute') || ariaLabel.includes('Turn on');
    return { isMuted: isMuted };
  }
  
  return { isMuted: true };
}
