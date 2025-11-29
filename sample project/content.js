// CONTENT - Meeting detection, UI status display, Auto-recording triggers, Duration tracking, Mute detection

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
let autoRecordInProgress = false;

function showMeetStatus(message, duration = 4000) {
    const existing = document.getElementById('meet-recorder-status');
    
    // For timer updates, just update the content instead of recreating
    if (existing && message.includes("Recording...")) {
        // Just update the content for timer messages
        existing.innerHTML = message.replace(/\n/g, '<br>');
        return; // Don't create new element or set timeout
    }
    
    // For non-timer messages, remove existing and create new
    if (existing) existing.remove();
    
    const status = document.createElement('div');
    status.id = 'meet-recorder-status';
    status.innerHTML = message.replace(/\n/g, '<br>');
    status.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0,0,0,0.95);
        color: white;
        padding: 12px 16px;
        border-radius: 10px;
        font-family: 'Google Sans', Arial, sans-serif;
        font-size: 14px;
        z-index: 100000;
        font-weight: bold;
        border: 2px solid #4285f4;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        backdrop-filter: blur(10px);
        max-width: 400px;
        word-wrap: break-word;
    `;
    
    document.body.appendChild(status);

    // Auto-remove only non-recording messages after specified duration
    if (!message.includes("Recording...")) {
        setTimeout(() => {
            const currentStatus = document.getElementById('meet-recorder-status');
            if (currentStatus && !currentStatus.innerHTML.includes("Recording...")) {
                currentStatus.remove();
            }
        }, duration);
    }
}

// Duration calculation
function startMeetingTimer() {
    meetingStartTime = Date.now();
    const startTime = new Date(meetingStartTime).toLocaleTimeString();
    console.log(`%c📅 Meeting started at : ${startTime}`,"color: #0f9d58; font-weight: bold;");

    showMeetStatus(`📅 Meeting started at: ${startTime}`, 5000);
}

function stopMeetingTimer() {
    if (meetingStartTime) {
        meetingEndTime = Date.now();
        totalMeetingDuration = Math.floor((meetingEndTime - meetingStartTime) / 1000);
        
        const minutes = Math.floor(totalMeetingDuration / 60);
        const seconds = totalMeetingDuration % 60;
        const endTime = new Date(meetingEndTime).toLocaleTimeString();

        console.log(`%c📅 Meeting ended at : ${new Date(meetingEndTime).toLocaleTimeString()}`, "color: #d93025; font-weight: bold;");
        console.log(`%c⏱️ Duration of meeting : ${minutes}m ${seconds}s`, "color: #f4b400; font-weight: bold;");

        showMeetStatus(`📅 Meeting ended at : ${endTime}\n Duration: ${minutes}m ${seconds}s`, 5000);

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

    const startTime = new Date(meetingStartTime).toLocaleTimeString();
    
    // Auto recording with proper 2-3 second delay
    if (autoRecordEnabled && !recordingStarted) {
      console.log("🔄 Auto-record enabled - starting recording in 3 seconds...");
      showMeetStatus(`📅 Meeting started at: ${startTime}\n🟡 Auto recording starting in 3 seconds...`);
      
      setTimeout(async () => {
        if (isInMeeting && autoRecordEnabled && !recordingStarted) {
          await autoRecordWithReset();
        }
      }, 3000); // 3 second delay
    } else {
      showMeetStatus(`📅 Meeting started at: ${startTime}`, 5000);
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

// Debug function to check current states
function debugStates() {
    console.log("🔍 DEBUG STATES:");
    console.log("- isInMeeting:", isInMeeting);
    console.log("- autoRecordEnabled:", autoRecordEnabled);
    console.log("- recordingStarted:", recordingStarted);
    console.log("- Leave button visible:", lastLeaveButtonVisible);
    
    // Check storage state
    chrome.storage.local.get(['isRecording', 'autoRecordPermission'], (result) => {
        console.log("- Storage isRecording:", result.isRecording);
        console.log("- Storage autoRecordPermission:", result.autoRecordPermission);
    });
    
    // Check background state
    chrome.runtime.sendMessage({ action: "getBackgroundState" }, (response) => {
        console.log("- Background currentRecordingTab:", response?.currentRecordingTab);
        console.log("- Background isAutoRecording:", response?.isAutoRecording);
    });
}

// Add this new function to content.js
function autoRecordWithReset() {
    console.log("🤖 AUTO-RECORD: Starting with reset...");
    
    // Quick reset without long delays
    recordingStarted = false;
    
    // Force meeting detection immediately
    forceMeetingRedetection();
    
    // Clear any conflicting storage
    chrome.storage.local.set({ 
        isRecording: false,
        recordingStoppedByTabClose: true
    });
    
    // Notify background
    chrome.runtime.sendMessage({ action: "refreshExtensionState" });
    
    // Start recording immediately (no additional delay)
    if (isInMeeting && autoRecordEnabled && !recordingStarted) {
        console.log("✅ Auto-record conditions met - starting immediately");
        startAutoRecording();
    } else {
        console.log("❌ Auto-record conditions not met after quick reset");
    }
}


// Enhanced force reset and retry function 
function forceResetAndRetry() {
    console.log("🔄 FORCE RESET - Resetting everything...");
    
    // Reset recording states but preserve meeting detection
    recordingStarted = false;
    
    // Use force detection instead of resetting isInMeeting
    forceMeetingRedetection();
    
    // Clear any existing status messages
    const existingStatus = document.getElementById('meet-recorder-status');
    if (existingStatus) existingStatus.remove();
    
    // Clear storage
    chrome.storage.local.set({ 
        isRecording: false,
        recordingStoppedByTabClose: true
    });
    
    // Notify background
    chrome.runtime.sendMessage({ action: "refreshExtensionState" });
    
    showMeetStatus("🔄 Force reset - checking meeting state...");
    
    // Wait and retry auto-record
    setTimeout(() => {
        console.log("🔄 Attempting auto-record after reset...");
        
        // Final check with force detection
        forceMeetingRedetection();
        
        if (isInMeeting && autoRecordEnabled && !recordingStarted) {
            console.log("✅ Conditions met - starting auto recording");
            startAutoRecording();
        } else {
            console.log("❌ Conditions not met after reset:", {
                isInMeeting,
                autoRecordEnabled,
                recordingStarted
            });
        }
    }, 3000);
}

// Force meeting re-detection
function forceMeetingRedetection() {
    console.log("🔍 Force re-detecting meeting state...");
    const leaveButton = findLeaveButton();
    const leaveVisible = leaveButton && isElementVisible(leaveButton);
    
    if (leaveVisible && !isInMeeting) {
        console.log("✅ Force detected: In meeting");
        isInMeeting = true;
        meetingStarted = true;
        if (!meetingStartTime) {
            startMeetingTimer();
        }
        return true;
    } else if (!leaveVisible && isInMeeting) {
        console.log("✅ Force detected: Not in meeting");
        isInMeeting = false;
        meetingStarted = false;
        return false;
    }
    return isInMeeting;
}


// Aggressive initial check function
function aggressiveInitialCheck() {
    setTimeout(() => {
        console.log("🔍 Aggressive initial meeting check...");
        checkMeetingState();
        setTimeout(() => {
            if (!isInMeeting) { // Only check if we're not already in a meeting
                checkMeetingState();
            }
        }, 2000);
    }, 1000);
}

// Start / Stop Auto Recording 
async function startAutoRecording() {
    if (recordingStarted) {
        console.log("⚠️ Auto recording already started, skipping");
        return;
    }

    autoRecordInProgress = true;
    
    console.log("🚀 Starting auto recording...");
    
    try {
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: "autoStartRecording" }, resolve);
        });
        
        if (response?.success) {
            recordingStarted = true;            
            
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
    } finally {
      autoRecordInProgress = false;
    }
}

// Enhanced initial setup with state recovery
async function initializeWithStateRecovery() {
    await checkAutoRecordPermission();
    setupLeaveButtonObserver();
    
    // Check if we need to recover from previous state
    const storageState = await new Promise(resolve => {
        chrome.storage.local.get(['isRecording', 'isInMeeting'], resolve);
    });
    
    console.log("🔄 State recovery check:", storageState);
    
    // If storage says we're in meeting but our state doesn't match, force re-detection
    if (storageState.isInMeeting && !isInMeeting) {
        console.log("🔄 Recovering meeting state from storage");
        forceMeetingRedetection();
    }
    
    // If storage says recording but we don't think so, reset
    if (storageState.isRecording && !recordingStarted) {
        console.log("🔄 Resetting inconsistent recording state");
        chrome.storage.local.set({ isRecording: false });
    }
    
    checkInitialMeetingState();

    setInterval(checkMeetingState, 2000);
    aggressiveInitialCheck();
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


// Listen for messages from popup
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
    const duration = message.duration || 4000;
    showMeetStatus(message.message, duration);
    sendResponse({ success: true });
  }
  
  if (message.action === "updateMeetTimer") {
    const status = document.getElementById('meet-recorder-status');
    if (status && status.textContent.includes('Recording')) {
        // Just update the existing element content
        status.textContent = `🔴 Recording... ${message.time}`;
    } else if (isInMeeting && recordingStarted) {
        // Show recording with timer if not already showing
        showMeetStatus(`🔴 Recording... ${message.time}`);
    }
  }

  // Add handler for recording completion
  if (message.action === "recordingCompleted") {
    recordingStarted = false;

    if (autoRecordEnabled) {
        showMeetStatus("✅ Auto Recording Completed & Downloaded");
    } else {
        showMeetStatus("✅ Recording Completed & Downloaded");
    }

    sendResponse({ success: true });
  }


  // Keep only this message handler
  if (message.action === "forceResetAndRetry") {
    console.log("📨 Received force reset command");
    forceResetAndRetry();
    sendResponse({ success: true });
  }
  
  return true;
});

// Initial Setup with State Recovery
setTimeout(async () => {
    await initializeWithStateRecovery();
    console.log("🔍 Meet Auto Recorder content script fully loaded with state recovery");
}, 1000);

// Check if already in meeting when script loads
function checkInitialMeetingState() {
    const leaveButton = findLeaveButton();
    const leaveVisible = leaveButton && isElementVisible(leaveButton);
    
    if (leaveVisible && !isInMeeting) {
        console.log("🔍 Already in meeting - will auto-start recording in 3 seconds");
        isInMeeting = true;
        meetingStarted = true;
        
        // Only start timer if not already running (page refresh case)
        if (!meetingStartTime) {
            startMeetingTimer();
        }
        
        if (autoRecordEnabled && !recordingStarted) {
            console.log("🚀 Auto-starting recording for existing meeting");
            showMeetStatus("🟡 Auto recording starting in 3 seconds...", 3000);
            setTimeout(async () => {
                await autoRecordWithReset();
            }, 3000);
        }
    }
}


// Add this periodic health check in content.js
function startPeriodicHealthChecks() {
  setInterval(() => {
    // Check if we're supposed to be recording but no recorder is active
    chrome.storage.local.get(['isRecording'], (result) => {
      if (result.isRecording && !recordingStarted) {
        console.log("⚠️ Storage says recording but content script doesn't - triggering cleanup");
        chrome.runtime.sendMessage({ action: "cleanupFailedRecorders" });
      }
    });
  }, 10000); // Check every 10 seconds
}

// Call this in your initialization
setTimeout(() => {
    startPeriodicHealthChecks();
}, 5000);


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
