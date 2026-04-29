// content.js - Records the ACTUAL huddle iframe with improved auto-recording

(function() {
    'use strict';

    const currentUrl = window.location.href;
    const isInIframe = window !== window.top;
    
    // ============================================================
    // DETECT IF WE ARE INSIDE THE ACTUAL HUDDLE IFRAME
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
        let callCheckInterval = null;
        let hasNotifiedBackground = false;
        
        // Helper to get the parent tab ID
        async function getTabId() {
            return new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: "getCurrentTabId" }, (response) => {
                    resolve(response?.tabId || null);
                });
            });
        }
        
        // Notify background that iframe is ready
        async function notifyIframeReady() {
            if (hasNotifiedBackground) return;
            
            const tabId = await getTabId();
            if (tabId) {
                console.log("📢 Notifying background that iframe is ready, tabId:", tabId);
                chrome.runtime.sendMessage({
                    action: "iframeReady",
                    tabId: tabId,
                    service: "gchat"
                });
                hasNotifiedBackground = true;
            }
        }
        
        // IMPROVED: Find Leave call button with more selectors
        function findLeaveButton() {
            const selectors = [
                'button[aria-label="Leave call"]',
                'button[aria-label="Leave"]',
                'button[aria-label="Exit call"]',
                'button[jsname="CQylAd"]',
                '[data-tooltip="Leave call"]',
                '[data-tooltip="Leave"]',
                'div[role="button"][aria-label*="Leave"]',
                'button[aria-label*="leave" i]',
                '[aria-label*="Leave call"]',
                'button[jsname="CuSJEf"]',  // Another possible leave button selector
                '.VfPpkd-LgbsSe.VfPpkd-LgbsSe-OWXEXe-INsAgc.NCcp5b.VfPpkd-LgbsSe-OWXEXe-dgl2Hf.ksBjEc.lKxP2d.LQeN7.XeH2Xb'
            ];
            
            for (const selector of selectors) {
                try {
                    const elements = document.querySelectorAll(selector);
                    for (const btn of elements) {
                        if (btn && btn.offsetParent !== null) {
                            console.log("✅ Found leave button with selector:", selector);
                            return btn;
                        }
                    }
                } catch (e) {
                    // Ignore invalid selectors
                }
            }
            
            // Also check for any button that might indicate active call
            const allButtons = document.querySelectorAll('button');
            for (const btn of allButtons) {
                const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                const text = (btn.textContent || '').toLowerCase();
                if ((ariaLabel.includes('leave') || text.includes('leave')) && btn.offsetParent !== null) {
                    console.log("✅ Found leave button by aria-label:", ariaLabel);
                    return btn;
                }
            }
            
            return null;
        }
        
        // IMPROVED: Check if currently in an active call
        function isInActiveCall() {
            const leaveBtn = findLeaveButton();
            
            // Also check for the call UI indicators
            const callUiSelectors = [
                '.zQt6Fd',  // Meet call container
                '[jsname="aCp9oc"]',  // Call controls
                '.uG2dDe',  // Another call indicator
                'div[data-is-muted]'  // Mute button indicator
            ];
            
            let hasCallUI = false;
            for (const selector of callUiSelectors) {
                try {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        hasCallUI = true;
                        break;
                    }
                } catch (e) {}
            }
            
            const isInCall = leaveBtn !== null || hasCallUI;
            console.log(`📞 Call detection: leaveBtn=${!!leaveBtn}, hasCallUI=${hasCallUI}, isInCall=${isInCall}`);
            return isInCall;
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
                console.error("❌ Cannot start - tab not found");
                showStatus("❌ Cannot start - tab not found", true);
                return false;
            }
            
            console.log(`🎬 Starting ${isAuto ? 'AUTO' : 'MANUAL'} recording for huddle`);
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
                    
                    // Notify popup
                    chrome.runtime.sendMessage({ action: "recordingStarted" });
                    return true;
                } else {
                    console.error("❌ Recording failed:", response.error);
                    showStatus("❌ Recording failed: " + (response.error || "Unknown error"), true);
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
            
            // Notify popup
            chrome.runtime.sendMessage({ action: "recordingStopped" });
        }
        
        // IMPROVED: Monitor call state changes with more aggressive detection
        async function checkCallState() {
            const inCall = isInActiveCall();
            
            // Call started
            if (inCall && !isInCall) {
                console.log("✅✅✅ HUDDLE CALL ACTIVE!");
                isInCall = true;
                callStartTime = Date.now();
                showStatus(`📅 Huddle started at ${new Date().toLocaleTimeString()}`);
                
                // Check auto-record setting directly from storage
                const result = await chrome.storage.local.get(['autoRecordPermissions']);
                autoRecordEnabled = result.autoRecordPermissions?.['gchat'] || false;
                console.log(`Auto-record setting: ${autoRecordEnabled ? 'ON' : 'OFF'}`);
                
                // Auto-start recording if enabled
                if (autoRecordEnabled && !isRecording) {
                    console.log("🎬 Auto-record ON - starting recording...");
                    // Small delay to ensure call is fully loaded
                    setTimeout(() => startRecording(true), 1500);
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
                    await stopRecording();
                }
            }
        }
        
        // Watch for DOM changes to detect join/leave
        function setupObserver() {
            if (mutationObserver) mutationObserver.disconnect();
            
            mutationObserver = new MutationObserver(() => {
                checkCallState();
            });
            
            // Observe the entire document for changes
            mutationObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'aria-label']
            });
        }
        
        // Listen for leave button click
        function watchForLeaveClick() {
            document.addEventListener('click', async (event) => {
                const target = event.target.closest('button, div[role="button"]');
                if (target) {
                    const ariaLabel = (target.getAttribute('aria-label') || '').toLowerCase();
                    const text = (target.textContent || '').toLowerCase();
                    if (ariaLabel.includes('leave') || text.includes('leave') || ariaLabel.includes('exit')) {
                        console.log("Leave button clicked - will stop recording");
                        // Wait a bit for the call to actually end
                        setTimeout(async () => {
                            if (isRecording) {
                                await stopRecording();
                            }
                        }, 500);
                    }
                }
            });
        }
        
        // Load auto-record setting
        async function loadSettings() {
            const result = await chrome.storage.local.get(['autoRecordPermissions']);
            autoRecordEnabled = result.autoRecordPermissions?.['gchat'] || false;
            console.log(`Auto-record setting loaded: ${autoRecordEnabled ? 'ON' : 'OFF'}`);
            return autoRecordEnabled;
        }
        
        // Listen for messages
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log("📨 Content script received message:", message.action);
            
            switch (message.action) {
                case "updateAutoRecordPermission":
                    autoRecordEnabled = message.enabled;
                    console.log(`Auto-record permission updated to: ${autoRecordEnabled}`);
                    showStatus(autoRecordEnabled ? "✅ Auto-record ENABLED" : "❌ Auto-record DISABLED", false, 2000);
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
                    
                case "ping":
                    sendResponse({ success: true });
                    break;
                    
                default:
                    sendResponse({ success: true });
            }
            return true;
        });
        
        // Initialize the recorder
        async function init() {
            console.log("🔥 Initializing Huddle Iframe Recorder");
            await loadSettings();
            setupObserver();
            watchForLeaveClick();
            
            // Initial call state check after a short delay
            setTimeout(() => {
                checkCallState();
            }, 2000);
            
            // Set up periodic checking (more frequent checks for better detection)
            if (callCheckInterval) clearInterval(callCheckInterval);
            callCheckInterval = setInterval(checkCallState, 1500);
            
            // Notify background that we're ready
            setTimeout(() => {
                notifyIframeReady();
            }, 1000);
            
            const statusMsg = autoRecordEnabled ? 
                "✅ Auto-record ON - Will record when you join huddle" :
                "📹 Huddle Recorder Ready\nEnable auto-record in popup or click Start Recording";
            showStatus(statusMsg);
            
            console.log("Huddle iframe recorder initialized, auto-record:", autoRecordEnabled);
        }
        
        // Start initialization
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
