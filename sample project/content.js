//WORKING CODE

// ------------------ Google Meet Auto Recorder ------------------
let isInMeeting = false;
let recordingStarted = false;
let autoRecordEnabled = false;
let leaveButtonObserver = null;
let lastLeaveButtonVisible = false;

// ------------------ Meeting Detection + Timer + Duration ------------------
let timerEl = null;
let timerInterval = null;
let recordStartTime = null;
let meetingStarted = false;
let meetingStartTime = null;
let meetingEndTime = null;
let totalMeetingDuration = 0;

// ------------------ DURATION CALCULATION ------------------
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

        // Save meeting stats to storage
        chrome.storage.local.set({
            lastMeetingDuration: totalMeetingDuration,
            lastMeetingEndTime: meetingEndTime
        });
        
        // Reset for next meeting
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

// ------------------ Check Auto Record Permission ------------------
async function checkAutoRecordPermission() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoRecordPermission'], (result) => {
      autoRecordEnabled = result.autoRecordPermission || false;
      console.log("🔐 Auto record enabled:", autoRecordEnabled);
      resolve(autoRecordEnabled);
    });
  });
}

// ------------------ Detect Leave Button ------------------
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

// ------------------ Check Meeting State ------------------
function checkMeetingState() {
  const leaveButton = findLeaveButton();
  const leaveVisible = leaveButton && isElementVisible(leaveButton);

  // Meeting joined
  if (leaveVisible && !lastLeaveButtonVisible) {
    console.log("✅ Leave button visible - Meeting joined");
    isInMeeting = true;
    meetingStarted = true;
    startMeetingTimer(); // 🆕 START DURATION TIMER
    
    if (autoRecordEnabled && !recordingStarted) {
      startAutoRecording();
    }
  }

  // Meeting ended
  if (!leaveVisible && lastLeaveButtonVisible) {
    console.log("❌ Leave button hidden - Meeting ended");
    isInMeeting = false;
    meetingStarted = false;
    stopMeetingTimer(); // 🆕 STOP DURATION TIMER
    
    // 🆕 CHECK ACTUAL RECORDING STATE FROM STORAGE (BOTH MODES)
    chrome.storage.local.get(['isRecording'], (result) => {
      if (result.isRecording) {
        console.log("🛑 Meeting ended - stopping recording");
        // For both modes, stop the recording
        chrome.runtime.sendMessage({ action: "stopRecordingOnMeetingEnd" });
      }
    });
  }

  lastLeaveButtonVisible = leaveVisible;
  chrome.storage.local.set({ isInMeeting });
}

// ------------------ Start / Stop Auto Recording ------------------
function startAutoRecording() {
  if (recordingStarted) return;
  recordingStarted = true;

  chrome.runtime.sendMessage({ action: "autoStartRecording" }, (response) => {
    if (response?.success) {
      console.log("✅ Auto recording started");
    } else {
      recordingStarted = false;
    }
  });
}

function stopAutoRecording() {
  if (!recordingStarted) return;
  recordingStarted = false;

  chrome.runtime.sendMessage({ action: "autoStopRecording" }, (response) => {
    if (response?.success) {
      console.log("✅ Auto recording stopped");
      // Also tell background to close recorder tab for auto mode
      if (autoRecordEnabled) {
        chrome.runtime.sendMessage({ action: "closeRecorderTab" });
      }
    } else {
      console.log("❌ Failed to stop auto recording");
    }
  });
}

// ------------------ Observe DOM Changes ------------------
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

// ------------------ Listen for Messages from Popup ------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateAutoRecordPermission") {
    autoRecordEnabled = message.enabled;
    if (autoRecordEnabled && isInMeeting && !recordingStarted) setTimeout(startAutoRecording, 1000);
    sendResponse({ success: true });
  }

  if (message.action === "checkMeetingStatus") {
    sendResponse({ 
      isInMeeting, 
      recording: recordingStarted, 
      autoRecordEnabled,
      meetingDuration: getCurrentMeetingDuration() // 🆕 ADD DURATION
    });
  }

  if (message.action === "autoStopRecording") {
    stopAutoRecording();
    sendResponse({ success: true });
  }

  // 🆕 NEW MESSAGES FOR DURATION
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
  
  return true;
});

// ------------------ Initial Setup ------------------
setTimeout(async () => {
  await checkAutoRecordPermission();
  setupLeaveButtonObserver();
  setInterval(checkMeetingState, 2000); // fallback
  console.log("🔍 Meet Auto Recorder content script fully loaded");
}, 1000);

// Add to content.js - mute status detection
function getMuteStatus() {
  // Look for mute button in Google Meet
  const muteButton = document.querySelector('[aria-label*="microphone"]') || 
                     document.querySelector('[data-tooltip*="microphone"]') ||
                     document.querySelector('[jscontroller*="microphone"]');
  
  if (muteButton) {
    const ariaLabel = muteButton.getAttribute('aria-label') || '';
    const isMuted = ariaLabel.includes('unmute') || ariaLabel.includes('Turn on');
    return { isMuted: isMuted };
  }
  
  // Fallback: check for mute icon
  const muteIcon = document.querySelector('svg[aria-label*="microphone"]');
  if (muteIcon) {
    const ariaLabel = muteIcon.getAttribute('aria-label') || '';
    const isMuted = ariaLabel.includes('unmute') || ariaLabel.includes('Turn on');
    return { isMuted: isMuted };
  }
  
  return { isMuted: true }; // Default to muted if can't detect
}

/*
//WORKING CODE

// ------------------ Google Meet Auto Recorder ------------------
let isInMeeting = false;
let recordingStarted = false;
let autoRecordEnabled = false;
let leaveButtonObserver = null;
let lastLeaveButtonVisible = false;

// ------------------ Meeting Detection + Timer + Duration ------------------
let timerEl = null;
let timerInterval = null;
let recordStartTime = null;
let meetingStarted = false;
let meetingStartTime = null;
let meetingEndTime = null;
let totalMeetingDuration = 0;

// ------------------ DURATION CALCULATION ------------------
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

        // Save meeting stats to storage
        chrome.storage.local.set({
            lastMeetingDuration: totalMeetingDuration,
            lastMeetingEndTime: meetingEndTime
        });
        
        // Reset for next meeting
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

// ------------------ Check Auto Record Permission ------------------
async function checkAutoRecordPermission() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoRecordPermission'], (result) => {
      autoRecordEnabled = result.autoRecordPermission || false;
      console.log("🔐 Auto record enabled:", autoRecordEnabled);
      resolve(autoRecordEnabled);
    });
  });
}

// ------------------ Detect Leave Button ------------------
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

// ------------------ Check Meeting State ------------------
function checkMeetingState() {
  const leaveButton = findLeaveButton();
  const leaveVisible = leaveButton && isElementVisible(leaveButton);

  // Meeting joined
  if (leaveVisible && !lastLeaveButtonVisible) {
    console.log("✅ Leave button visible - Meeting joined");
    isInMeeting = true;
    meetingStarted = true;
    startMeetingTimer(); // 🆕 START DURATION TIMER
    
    if (autoRecordEnabled && !recordingStarted) {
      startAutoRecording();
    }
  }

  // Meeting ended
  if (!leaveVisible && lastLeaveButtonVisible) {
    console.log("❌ Leave button hidden - Meeting ended");
    isInMeeting = false;
    meetingStarted = false;
    stopMeetingTimer(); // 🆕 STOP DURATION TIMER
    
    // 🆕 CHECK ACTUAL RECORDING STATE FROM STORAGE (BOTH MODES)
    chrome.storage.local.get(['isRecording'], (result) => {
      if (result.isRecording) {
        console.log("🛑 Meeting ended - stopping recording");
        // For both modes, stop the recording
        chrome.runtime.sendMessage({ action: "stopRecordingOnMeetingEnd" });
      }
    });
  }

  lastLeaveButtonVisible = leaveVisible;
  chrome.storage.local.set({ isInMeeting });
}

// ------------------ Start / Stop Auto Recording ------------------
function startAutoRecording() {
  if (recordingStarted) return;
  recordingStarted = true;

  chrome.runtime.sendMessage({ action: "autoStartRecording" }, (response) => {
    if (response?.success) {
      console.log("✅ Auto recording started");
    } else {
      recordingStarted = false;
    }
  });
}

function stopAutoRecording() {
  if (!recordingStarted) return;
  recordingStarted = false;

  chrome.runtime.sendMessage({ action: "autoStopRecording" }, (response) => {
    if (response?.success) {
      console.log("✅ Auto recording stopped");
      // Also tell background to close recorder tab for auto mode
      if (autoRecordEnabled) {
        chrome.runtime.sendMessage({ action: "closeRecorderTab" });
      }
    } else {
      console.log("❌ Failed to stop auto recording");
    }
  });
}

// ------------------ Observe DOM Changes ------------------
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

// ------------------ MEET UI STATUS DISPLAY ------------------
function showMeetStatus(message) {
    // Remove existing status
    const existing = document.getElementById('meet-recorder-status');
    if (existing) existing.remove();
    
    // Create new status
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
    `;
    
    document.body.appendChild(status);

    // 🆕 AUTO-HIDE FOR STARTED AND SAVED MESSAGES
    if (message.includes("Recording started") || message.includes("Recording saved") || message.includes("Recording failed")) {
        setTimeout(() => {
            const currentStatus = document.getElementById('meet-recorder-status');
            if (currentStatus && currentStatus.textContent === message) {
                currentStatus.remove();
            }
        }, 3000); // Hide after 3 seconds
    }
}

// ------------------ Listen for Messages from Popup ------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateAutoRecordPermission") {
    autoRecordEnabled = message.enabled;
    if (autoRecordEnabled && isInMeeting && !recordingStarted) setTimeout(startAutoRecording, 1000);
    sendResponse({ success: true });
  }

  if (message.action === "checkMeetingStatus") {
    sendResponse({ 
      isInMeeting, 
      recording: recordingStarted, 
      autoRecordEnabled,
      meetingDuration: getCurrentMeetingDuration() // 🆕 ADD DURATION
    });
  }

  if (message.action === "autoStopRecording") {
    stopAutoRecording();
    sendResponse({ success: true });
  }

  // 🆕 NEW MESSAGES FOR DURATION
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
  
  // 🆕 NEW: Listen for status updates
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

// ------------------ Initial Setup ------------------
setTimeout(async () => {
  await checkAutoRecordPermission();
  setupLeaveButtonObserver();
  setInterval(checkMeetingState, 2000); // fallback
  console.log("🔍 Meet Auto Recorder content script fully loaded");
}, 1000);

// Add to content.js - mute status detection
function getMuteStatus() {
  // Look for mute button in Google Meet
  const muteButton = document.querySelector('[aria-label*="microphone"]') || 
                     document.querySelector('[data-tooltip*="microphone"]') ||
                     document.querySelector('[jscontroller*="microphone"]');
  
  if (muteButton) {
    const ariaLabel = muteButton.getAttribute('aria-label') || '';
    const isMuted = ariaLabel.includes('unmute') || ariaLabel.includes('Turn on');
    return { isMuted: isMuted };
  }
  
  // Fallback: check for mute icon
  const muteIcon = document.querySelector('svg[aria-label*="microphone"]');
  if (muteIcon) {
    const ariaLabel = muteIcon.getAttribute('aria-label') || '';
    const isMuted = ariaLabel.includes('unmute') || ariaLabel.includes('Turn on');
    return { isMuted: isMuted };
  }
  
  return { isMuted: true }; // Default to muted if can't detect
}
*/
