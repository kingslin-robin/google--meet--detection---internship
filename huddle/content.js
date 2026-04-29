// content.js - Records the ACTUAL huddle iframe, not the parent page

(function() {
    'use strict';

    const currentUrl = window.location.href;
    const isInIframe = window !== window.top;
    
    // ============================================================
    // DETECT IF WE ARE INSIDE THE ACTUAL HUDDLE IFRAME
    // This is the key - we need to run code INSIDE the huddle
    // ============================================================
    const isHuddleIframe = currentUrl.includes('meet.google.com/_/frame');
    
    console.log("🔍 Content script location:", {
        url: currentUrl,
        isIframe: isInIframe,
        isHuddleIframe: isHuddleIframe
    });
    
    // ============================================================
    // WE ARE IN THE HUDDLE IFRAME - THIS IS WHERE THE CALL HAPPENS
    // ============================================================
    if (isHuddleIframe) {
        console.log("🎯🎯🎯 INSIDE HUDDLE IFRAME - WILL RECORD THE CALL! 🎯🎯🎯");
        startHuddleIframeRecorder();
    }
    // ============================================================
    // WE ARE IN PARENT PAGE - JUST WATCH FOR HUDDLE TO OPEN
    // ============================================================
    else if (currentUrl.includes('chat.google.com') || currentUrl.includes('mail.google.com')) {
        console.log("📧 Google Chat parent page - monitoring for huddle iframe");
        monitorForHuddleIframe();
    }
    // ============================================================
    // STANDALONE GOOGLE MEET
    // ============================================================
    else if (currentUrl.includes('meet.google.com')) {
        console.log("📹 Standalone Google Meet");
        initStandaloneMeet();
    }

    // ============================================================
    // HUDDLE IFRAME RECORDER - RUNS INSIDE THE MEET IFRAME
    // ============================================================
    function startHuddleIframeRecorder() {
        console.log("🔴🔴🔴 HUDDLE IFRAME RECORDER INITIALIZED 🔴🔴🔴");
        
        let isInCall = false;
        let isRecording = false;
        let autoRecordEnabled = false;
        let callStartTime = null;
        let mutationObserver = null;
        
        // Helper to get the parent tab ID (the Google Chat tab)
        async function getTabId() {
            return new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: "getCurrentTabId" }, (response) => {
                    resolve(response?.tabId || null);
                });
            });
        }
        
        // Find the Leave call button (indicates we're in a call)
        function findLeaveButton() {
            const selectors = [
                'button[aria-label="Leave call"]',
                'button[aria-label*="Leave"]',
                'button[aria-label*="Exit"]',
                'button[jsname="CQylAd"]',
                '[data-tooltip="Leave call"]',
                'div[role="button"][aria-label*="Leave"]'
            ];
            
            for (const selector of selectors) {
                const btn = document.querySelector(selector);
                if (btn && btn.offsetParent !== null) {
                    return btn;
                }
            }
            return null;
        }
        
        // Find Join button (indicates we're not in a call yet)
        function findJoinButton() {
            const selectors = [
                'button[aria-label*="Join"]',
                'button[aria-label*="Start"]'
            ];
            for (const selector of selectors) {
                const btn = document.querySelector(selector);
                if (btn && btn.offsetParent !== null) {
                    return btn;
                }
            }
            return null;
        }
        
        // Check if currently in an active huddle call
        function isInActiveCall() {
            const leaveBtn = findLeaveButton();
            const joinBtn = findJoinButton();
            // In call = leave button visible OR join button not visible
            return leaveBtn !== null || joinBtn === null;
        }
        
        // Show status indicator INSIDE the huddle
        function showStatus(message, isError = false, duration = 4000) {
            let statusDiv = document.getElementById('huddle-recorder-status');
            
            if (!statusDiv) {
                statusDiv = document.createElement('div');
                statusDiv.id = 'huddle-recorder-status';
                statusDiv.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: #1a1a2e;
                    color: #ffffff;
                    padding: 12px 18px;
                    border-radius: 12px;
                    font-family: 'Google Sans', monospace;
                    font-size: 14px;
                    font-weight: bold;
                    z-index: 9999999 !important;
                    border-left: 4px solid ${isError ? '#ff4444' : '#4CAF50'};
                    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
                    backdrop-filter: blur(8px);
                    pointer-events: none;
                `;
                document.body.appendChild(statusDiv);
            }
            
            statusDiv.textContent = message;
            statusDiv.style.borderLeftColor = isError ? '#ff4444' : '#4CAF50';
            
            if (!message.includes('Recording') && duration > 0) {
                setTimeout(() => {
                    if (statusDiv && statusDiv.parentNode) {
                        statusDiv.remove();
                    }
                }, duration);
            }
        }
        
        // Start recording the huddle
        async function startRecording(isAuto = true) {
            if (isRecording) {
                console.log("Already recording");
                return false;
            }
            
            const tabId = await getTabId();
            if (!tabId) {
                showStatus("❌ Cannot start - tab not found", true);
                return false;
            }
            
            showStatus(isAuto ? "🎬 Auto-recording starting..." : "🎬 Starting recording...");
            
            try {
                const response = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({
                        action: "startRecording",
                        tabId: tabId,
                        service: "gchat",
                        isAuto: isAuto
                    }, (response) => {
                        resolve(response || { success: false });
                    });
                });
                
                if (response.success) {
                    isRecording = true;
                    showStatus("🔴 RECORDING HUDDLE CALL...\n🎤 Audio + Microphone");
                    console.log("✅ Recording started successfully");
                    return true;
                } else {
                    showStatus("❌ Recording failed", true);
                    return false;
                }
            } catch (err) {
                console.error("Start error:", err);
                showStatus("❌ " + err.message, true);
                return false;
            }
        }
        
        // Stop recording
        async function stopRecording() {
            if (!isRecording) return;
            
            console.log("🛑 Stopping huddle recording");
            showStatus("🟡 Stopping recording...");
            
            await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: "manualStopRecording" }, () => resolve());
            });
            
            isRecording = false;
            showStatus("✅ Recording saved to Downloads", false, 5000);
        }
        
        // Monitor call state changes
        function checkCallState() {
            const inCall = isInActiveCall();
            
            // Call started
            if (inCall && !isInCall) {
                console.log("✅✅✅ HUDDLE CALL ACTIVE!");
                isInCall = true;
                callStartTime = Date.now();
                showStatus(`📅 Huddle started at ${new Date().toLocaleTimeString()}`);
                
                // Auto-start recording if enabled
                if (autoRecordEnabled && !isRecording) {
                    console.log("Auto-record ON - starting in 2 seconds");
                    setTimeout(() => startRecording(true), 2000);
                }
            }
            // Call ended
            else if (!inCall && isInCall) {
                console.log("❌❌❌ HUDDLE CALL ENDED!");
                
                if (callStartTime) {
                    const duration = Math.floor((Date.now() - callStartTime) / 1000);
                    const mins = Math.floor(duration / 60);
                    const secs = duration % 60;
                    showStatus(`📅 Huddle ended\n⏱️ Duration: ${mins}m ${secs}s`);
                }
                
                isInCall = false;
                callStartTime = null;
                
                // Auto-stop recording if active
                if (isRecording) {
                    console.log("Call ended - auto-stopping recording");
                    stopRecording();
                }
            }
        }
        
        // Watch for DOM changes to detect join/leave
        function setupObserver() {
            if (mutationObserver) mutationObserver.disconnect();
            
            mutationObserver = new MutationObserver(() => {
                checkCallState();
            });
            
            mutationObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'aria-label']
            });
        }
        
        // Listen for leave button click
        function watchForLeaveClick() {
            document.addEventListener('click', (event) => {
                const target = event.target.closest('button, div[role="button"]');
                if (target) {
                    const ariaLabel = (target.getAttribute('aria-label') || '').toLowerCase();
                    if (ariaLabel.includes('leave') || ariaLabel.includes('exit')) {
                        console.log("Leave button clicked - will stop recording");
                        setTimeout(() => {
                            if (isRecording) stopRecording();
                        }, 500);
                    }
                }
            });
        }
        
        // Load auto-record setting
        async function loadSettings() {
            const result = await chrome.storage.local.get(['autoRecordPermissions']);
            autoRecordEnabled = result.autoRecordPermissions?.['gchat'] || false;
            console.log(`Auto-record: ${autoRecordEnabled ? 'ON' : 'OFF'}`);
            return autoRecordEnabled;
        }
        
        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.action) {
                case "updateAutoRecordPermission":
                    autoRecordEnabled = message.enabled;
                    showStatus(autoRecordEnabled ? "✅ Auto-record ENABLED" : "❌ Auto-record DISABLED");
                    sendResponse({ success: true });
                    break;
                    
                case "manualRecordingStarted":
                    isRecording = true;
                    showStatus("🔴 RECORDING HUDDLE CALL...");
                    sendResponse({ success: true });
                    break;
                    
                case "manualRecordingStopped":
                    isRecording = false;
                    sendResponse({ success: true });
                    break;
                    
                case "updateMeetTimer":
                    if (isRecording) {
                        const status = document.getElementById('huddle-recorder-status');
                        if (status && status.textContent.includes('RECORDING')) {
                            status.textContent = `🔴 RECORDING HUDDLE... ${message.time}`;
                        }
                    }
                    sendResponse({ success: true });
                    break;
                    
                case "recordingCompleted":
                    isRecording = false;
                    showStatus("✅ Recording saved!");
                    sendResponse({ success: true });
                    break;
                    
                default:
                    sendResponse({ success: true });
            }
            return true;
        });
        
        // Initialize
        async function init() {
            console.log("🔥 Initializing Huddle Iframe Recorder");
            await loadSettings();
            setupObserver();
            watchForLeaveClick();
            
            setTimeout(() => checkCallState(), 1000);
            setInterval(checkCallState, 2000);
            
            const statusMsg = autoRecordEnabled ? 
                "✅ Auto-record ON - Will record when you join huddle" :
                "📹 Huddle Recorder Ready\nEnable auto-record in popup or click Start Recording";
            showStatus(statusMsg);
        }
        
        init();
    }

    // ============================================================
    // MONITOR FOR HUDDLE IFRAME FROM PARENT PAGE
    // ============================================================
    function monitorForHuddleIframe() {
        console.log("👀 Monitoring for huddle iframe from parent");
        
        let notifyShown = false;
        
        function showHint(message) {
            let hint = document.getElementById('huddle-hint');
            if (hint) hint.remove();
            
            hint = document.createElement('div');
            hint.id = 'huddle-hint';
            hint.textContent = message;
            hint.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #1a73e8;
                color: white;
                padding: 8px 14px;
                border-radius: 20px;
                font-size: 12px;
                z-index: 100000;
                font-weight: bold;
            `;
            document.body.appendChild(hint);
            setTimeout(() => hint.remove(), 3000);
        }
        
        function checkForIframe() {
            const iframes = document.querySelectorAll('iframe[src*="meet.google.com/_/frame"]');
            
            for (const iframe of iframes) {
                const rect = iframe.getBoundingClientRect();
                const isVisible = iframe.offsetParent !== null && rect.width > 0;
                
                if (isVisible && !iframe.dataset.recorderNotified) {
                    iframe.dataset.recorderNotified = "true";
                    console.log("🎯 Huddle iframe detected - recorder active inside");
                    
                    if (!notifyShown) {
                        notifyShown = true;
                        showHint("🎬 Huddle detected! Recorder is ready inside the call");
                    }
                }
            }
        }
        
        const observer = new MutationObserver(() => checkForIframe());
        observer.observe(document.body, { childList: true, subtree: true });
        
        checkForIframe();
        setInterval(checkForIframe, 2000);
    }
    
    // ============================================================
    // STANDALONE GOOGLE MEET
    // ============================================================
    function initStandaloneMeet() {
        console.log("Standalone Google Meet ready");
        
        let inMeeting = false;
        let isRecording = false;
        
        function findLeaveBtn() {
            const btn = document.querySelector('button[aria-label="Leave call"], button[jsname="CQylAd"]');
            return btn && btn.offsetParent !== null ? btn : null;
        }
        
        function checkMeeting() {
            const inCall = findLeaveBtn() !== null;
            
            if (inCall !== inMeeting) {
                inMeeting = inCall;
                if (!inMeeting && isRecording) {
                    chrome.runtime.sendMessage({ action: "manualStopRecording" });
                    isRecording = false;
                }
            }
        }
        
        setInterval(checkMeeting, 2000);
        
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg.action === "manualRecordingStarted") {
                isRecording = true;
                sendResponse({ success: true });
            }
            if (msg.action === "manualRecordingStopped") {
                isRecording = false;
                sendResponse({ success: true });
            }
            return true;
        });
    }
    
    console.log("✅ Content script loaded");
})();