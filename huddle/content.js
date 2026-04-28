// UNIFIED CONTENT.JS - Google Meet, Microsoft Teams, Zoom & Google Chat

(function() {
    'use strict';

    function detectService() {
        const url = window.location.href;
        if (url.includes('meet.google.com')) return 'gmeet';
        if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
        if (url.includes('zoom.us') || url.includes('zoom.com')) return 'zoom';
        if (url.includes('chat.google.com') || (url.includes('mail.google.com') && url.includes('chat'))) return 'gchat';
        return null;
    }

    const currentService = detectService();
    const isInIframe = window !== window.top;
    
    // Check if this is the Google Meet iframe inside Google Chat
    const isGoogleMeetIframe = isInIframe && window.location.href.includes('meet.google.com/_/frame');
    
    console.log(`🔍 Content script initializing for: ${currentService} (in iframe: ${isInIframe}, isMeetIframe: ${isGoogleMeetIframe})`);

    // If this is the Google Meet iframe inside Google Chat Huddle
    if (isGoogleMeetIframe) {
        console.log("🎯 DETECTED: Google Meet iframe inside Google Chat Huddle!");
        console.log("📍 This is the actual huddle call - we should record this!");
        googleChatHuddleIframeContent();
    } 
    // For Google Meet main page
    else if (currentService === 'gmeet') {
        if (isInIframe && window.location.pathname.includes('/_/frame')) {
            console.log("✅ Running inside Google Meet iframe");
            gmeetContent();
        } else if (!isInIframe) {
            console.log("🔍 Running in main Google Meet page");
            setupIframeDetection();
        } else {
            gmeetContent();
        }
    } 
    // For Google Chat main page - detect when huddle iframe appears
    else if (currentService === 'gchat') {
        console.log("🔍 Running in Google Chat - watching for huddle iframe");
        detectGoogleChatHuddleIframe();
    } 
    else if (currentService === 'teams') {
        teamsContent();
    } 
    else if (currentService === 'zoom') {
        zoomContent();
    }

    // ==================== GOOGLE CHAT HUDDLE IFRAME (The actual call) ====================
    function googleChatHuddleIframeContent() {
        console.log("🔴 GOOGLE CHAT HUDDLE IFRAME DETECTED - Setting up auto-recording!");
        
        let isInCall = false;
        let recordingStarted = false;
        let autoRecordEnabled = false;
        let callStartTime = null;
        let leaveButtonObserver = null;
        let lastLeaveButtonVisible = false;
        let autoRecordAttempted = false;

        // Get the current tab ID from parent or use a fixed approach
        let currentTabId = null;
        
        // Try to get tab ID from URL parameters or parent
        function getCurrentTabId() {
            return new Promise((resolve) => {
                // First try to get from parent window
                try {
                    if (window.parent && window.parent !== window) {
                        // Send message to parent to get tab ID
                        window.parent.postMessage({ type: 'GET_TAB_ID' }, '*');
                    }
                } catch(e) {}
                
                // Fallback: use chrome.tabs.query with a timeout
                if (typeof chrome !== 'undefined' && chrome.tabs) {
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs && tabs[0] && tabs[0].id) {
                            resolve(tabs[0].id);
                        } else {
                            resolve(null);
                        }
                    });
                } else {
                    resolve(null);
                }
            });
        }

        // Find the leave/end call button in the Meet iframe
        function findLeaveButton() {
            const selectors = [
                'button[aria-label="Leave call"]',
                'button[aria-label*="Leave call"]',
                'button[aria-label*="End call" i]',
                'button[aria-label*="Exit" i]',
                'div[role="button"][data-tooltip="Leave call"]',
                'button[jscontroller][jsname][aria-label*="Leave"]',
                '[data-tooltip="Leave call"]',
                '[aria-label="Leave call"]',
                '.VfPpkd-Bz112c-LgbsSe[aria-label*="Leave"]'
            ];
            
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && isElementVisible(el)) {
                    console.log(`✅ Found leave button with selector: ${selector}`);
                    return el;
                }
            }
            
            // Search by text/aria-label
            const allButtons = document.querySelectorAll('button, div[role="button"]');
            for (const btn of allButtons) {
                const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
                
                if ((ariaLabel.includes('leave') || tooltip.includes('leave') || 
                     ariaLabel.includes('end call') || ariaLabel.includes('exit')) &&
                    !ariaLabel.includes('join')) {
                    if (isElementVisible(btn)) {
                        console.log(`✅ Found leave button by content: ${ariaLabel || tooltip}`);
                        return btn;
                    }
                }
            }
            
            return null;
        }

        // Find join button (to detect when call starts)
        function findJoinButton() {
            const selectors = [
                'button[aria-label*="Join" i]',
                'button[aria-label*="Start" i]',
                'div[role="button"][aria-label*="Join" i]',
                '[data-tooltip*="Join" i]'
            ];
            
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && isElementVisible(el)) {
                    console.log(`🔍 Found join button with selector: ${selector}`);
                    return el;
                }
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

        function showHuddleStatus(message, duration = 4000) {
            const existing = document.getElementById('gchat-huddle-status');
            
            if (existing && message.includes("Recording...")) {
                existing.innerHTML = message.replace(/\n/g, '<br>');
                return;
            }
            
            if (existing) existing.remove();
            
            const status = document.createElement('div');
            status.id = 'gchat-huddle-status';
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
                border: 2px solid #ea4335;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                backdrop-filter: blur(10px);
                max-width: 400px;
                word-wrap: break-word;
            `;
            
            document.body.appendChild(status);

            if (!message.includes("Recording...")) {
                setTimeout(() => {
                    const currentStatus = document.getElementById('gchat-huddle-status');
                    if (currentStatus && !currentStatus.innerHTML.includes("Recording...")) {
                        currentStatus.remove();
                    }
                }, duration);
            }
        }

        function startCallTimer() {
            callStartTime = Date.now();
            const startTime = new Date(callStartTime).toLocaleTimeString();
            console.log(`%c📅 Google Chat Huddle started at : ${startTime}`, "color: #ea4335; font-weight: bold;");
            showHuddleStatus(`📅 Huddle started at: ${startTime}`, 5000);
        }

        function stopCallTimer() {
            if (callStartTime) {
                const callEndTime = Date.now();
                const totalDuration = Math.floor((callEndTime - callStartTime) / 1000);
                const minutes = Math.floor(totalDuration / 60);
                const seconds = totalDuration % 60;
                const endTime = new Date(callEndTime).toLocaleTimeString();

                console.log(`%c📅 Huddle ended at : ${endTime}`, "color: #d93025; font-weight: bold;");
                console.log(`%c⏱️ Duration of huddle : ${minutes}m ${seconds}s`, "color: #f4b400; font-weight: bold;");

                showHuddleStatus(`📅 Huddle ended at: ${endTime}\n Duration: ${minutes}m ${seconds}s`, 5000);

                if (typeof chrome !== 'undefined' && chrome.storage) {
                    chrome.storage.local.set({
                        lastMeetingDuration: totalDuration,
                        lastMeetingEndTime: callEndTime
                    });
                }
                
                callStartTime = null;
            }
        }

        async function checkAutoRecordPermission() {
            return new Promise((resolve) => {
                if (typeof chrome === 'undefined' || !chrome.storage) {
                    console.log("⚠️ Chrome storage not available");
                    resolve(false);
                    return;
                }
                
                chrome.storage.local.get(['autoRecordPermissions'], (result) => {
                    autoRecordEnabled = result.autoRecordPermissions?.['gchat'] || false;
                    console.log(`🔐 Auto record enabled for gchat huddle:`, autoRecordEnabled);
                    resolve(autoRecordEnabled);
                });
            });
        }

        async function startRecordingForHuddleIframe(isAuto = true) {
            if (recordingStarted) {
                console.log("⚠️ Recording already started, skipping");
                return false;
            }
            
            console.log(`🚀 Starting ${isAuto ? 'AUTO' : 'MANUAL'} recording for Google Chat Huddle iframe...`);

            try {
                // Check if chrome API is available
                if (typeof chrome === 'undefined' || !chrome.runtime) {
                    console.error("❌ Chrome runtime not available in iframe");
                    showHuddleStatus("❌ Recording Error: Extension context not available", 3000);
                    return false;
                }
                
                // Get current tab ID - use a safer approach
                let tabId = null;
                
                // Try to get tab ID from the URL (extract from parent if possible)
                try {
                    // Send message to background instead of querying tabs directly
                    const response = await new Promise((resolve) => {
                        chrome.runtime.sendMessage({ 
                            action: "getCurrentTabId"
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.log("⚠️ Error getting tab ID:", chrome.runtime.lastError);
                                resolve(null);
                            } else {
                                resolve(response);
                            }
                        });
                    });
                    
                    if (response && response.tabId) {
                        tabId = response.tabId;
                    }
                } catch(e) {
                    console.log("⚠️ Could not get tab ID via message:", e);
                }
                
                if (!tabId) {
                    console.error("❌ Could not determine tab ID");
                    showHuddleStatus("❌ Recording Error: Could not identify tab", 3000);
                    return false;
                }
                
                console.log("📤 Sending manualStartRecording for huddle iframe, tabId:", tabId);
                
                const response = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ 
                        action: "manualStartRecording", 
                        tabId: tabId,
                        service: "gchat"
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.error("❌ Runtime error:", chrome.runtime.lastError);
                            resolve({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            resolve(response);
                        }
                    });
                });
                
                if (response && response.success) {
                    recordingStarted = true;            
                    if (typeof chrome !== 'undefined' && chrome.storage) {
                        chrome.storage.local.set({ isRecording: true });
                    }
                    showHuddleStatus("🔴 Recording Huddle Call...");
                    console.log("✅ Huddle recording started successfully");
                    
                    // Notify parent that recording started
                    try {
                        window.parent.postMessage({ type: 'HUDDLE_RECORDING_STARTED' }, '*');
                    } catch(e) {}
                    return true;
                } else {
                    console.log("❌ Failed to start recording:", response);
                    showHuddleStatus("❌ Recording Failed", 3000);
                    return false;
                }
            } catch (error) {
                console.log("❌ Error starting recording:", error);
                showHuddleStatus("❌ Recording Error: " + (error.message || "Unknown error"), 3000);
                return false;
            }
        }

        function checkCallState() {
            const leaveButton = findLeaveButton();
            const leaveVisible = leaveButton && isElementVisible(leaveButton);
            const joinButton = findJoinButton();
            const joinVisible = joinButton && isElementVisible(joinButton);

            // Call is active when leave button is visible (or join button is not visible)
            const isActive = leaveVisible || !joinVisible;
            
            console.log(`🔍 Call state check - leaveVisible: ${leaveVisible}, joinVisible: ${joinVisible}, isActive: ${isActive}, isInCall: ${isInCall}, autoRecordEnabled: ${autoRecordEnabled}, recordingStarted: ${recordingStarted}, autoRecordAttempted: ${autoRecordAttempted}`);

            // Call started
            if (isActive && !isInCall) {
                console.log("✅ Huddle call detected as ACTIVE!");
                isInCall = true;
                startCallTimer();
                
                // Auto-record logic
                if (autoRecordEnabled && !recordingStarted && !autoRecordAttempted) {
                    autoRecordAttempted = true;
                    console.log("🔄 Auto-record is ENABLED - starting recording in 3 seconds...");
                    showHuddleStatus("🟡 Auto recording starting in 3 seconds...");
                    
                    if (window.autoRecordTimeout) {
                        clearTimeout(window.autoRecordTimeout);
                    }
                    
                    window.autoRecordTimeout = setTimeout(async () => {
                        if (isInCall && autoRecordEnabled && !recordingStarted) {
                            console.log("🎬 Executing auto-recording now...");
                            await startRecordingForHuddleIframe(true);
                        } else {
                            console.log("⚠️ Auto-recording conditions not met:", {isInCall, autoRecordEnabled, recordingStarted});
                        }
                    }, 3000);
                } else {
                    console.log(`ℹ️ Auto-record not triggered: autoEnabled=${autoRecordEnabled}, recordingStarted=${recordingStarted}, attempted=${autoRecordAttempted}`);
                    if (!autoRecordEnabled) {
                        showHuddleStatus("✅ Huddle active - Auto-recording is OFF. Click 'Start Recording' to record", 5000);
                    }
                }
            }

            // Call ended
            if (!isActive && isInCall) {
                console.log("❌ Huddle call ended!");
                isInCall = false;
                autoRecordAttempted = false;
                stopCallTimer();
                
                if (window.autoRecordTimeout) {
                    clearTimeout(window.autoRecordTimeout);
                    window.autoRecordTimeout = null;
                }
        
                if (recordingStarted) {
                    console.log("🛑 Huddle ended - stopping recording");
                    if (typeof chrome !== 'undefined' && chrome.runtime) {
                        chrome.runtime.sendMessage({ action: "stopRecordingOnMeetingEnd" });
                    }
                    recordingStarted = false;
                }
            }

            lastLeaveButtonVisible = leaveVisible;
        }

        function setupLeaveButtonObserver() {
            if (leaveButtonObserver) leaveButtonObserver.disconnect();
            leaveButtonObserver = new MutationObserver(() => {
                setTimeout(checkCallState, 500);
            });
            leaveButtonObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'aria-hidden', 'disabled']
            });
        }

        // Initialize Huddle iframe detection
        setTimeout(async () => {
            await checkAutoRecordPermission();
            setupLeaveButtonObserver();
            
            // Check call state immediately and then every second
            setTimeout(() => checkCallState(), 500);
            setInterval(checkCallState, 2000);
            
            console.log("🔍 Google Chat Huddle Iframe Recorder fully loaded");
            console.log(`📍 Auto-record is ${autoRecordEnabled ? 'ENABLED' : 'DISABLED'}`);
            console.log("📍 Ready to detect and record huddle calls!");
            
            if (autoRecordEnabled) {
                showHuddleStatus("✅ Auto-record ENABLED - Will record when huddle starts", 5000);
            } else {
                showHuddleStatus("✅ Huddle Recorder Ready - Enable Auto-record or click Start Recording", 5000);
            }
        }, 1000);

        // Listen for messages from background/popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log("📨 Huddle iframe received message:", message.action);
            
            if (message.action === "updateAutoRecordPermission") {
                autoRecordEnabled = message.enabled;
                console.log(`🔄 Auto record permission updated to: ${autoRecordEnabled}`);
                showHuddleStatus(autoRecordEnabled ? "✅ Auto-recording ENABLED" : "❌ Auto-recording DISABLED", 3000);
                sendResponse({ success: true });
            }

            if (message.action === "manualRecordingStarted") {
                console.log("🎬 Manual recording started for huddle iframe");
                recordingStarted = true;
                showHuddleStatus("🔴 Recording Huddle Call...");
                sendResponse({ success: true });
            }
    
            if (message.action === "manualRecordingStopped") {
                console.log("🛑 Manual recording stopped for huddle iframe");
                recordingStarted = false;
                showHuddleStatus("✅ Recording stopped", 3000);
                sendResponse({ success: true });
            }

            if (message.action === "checkMeetingStatus") {
                sendResponse({ 
                    isInMeeting: isInCall, 
                    recording: recordingStarted, 
                    autoRecordEnabled
                });
            }

            if (message.action === "updateMeetTimer") {
                const status = document.getElementById('gchat-huddle-status');
                if (status && status.textContent.includes('Recording')) {
                    status.textContent = `🔴 Recording Huddle... ${message.time}`;
                } else if (isInCall && recordingStarted) {
                    showHuddleStatus(`🔴 Recording Huddle... ${message.time}`);
                }
                sendResponse({ success: true });
            }

            if (message.action === "recordingCompleted") {
                recordingStarted = false;
                showHuddleStatus("✅ Recording Completed & Downloaded", 5000);
                sendResponse({ success: true });
            }

            if (message.action === "startManualRecordingFromIframe") {
                console.log("🎬 Manual recording requested from parent");
                startRecordingForHuddleIframe(false).then(result => {
                    sendResponse({ success: result });
                });
                return true;
            }
            
            return true;
        });
    }

    // ==================== DETECT GOOGLE CHAT HUDDLE IFRAME ====================
    function detectGoogleChatHuddleIframe() {
        console.log("🔍 Watching for Google Meet iframe in Google Chat...");
        
        let iframeInjected = false;
        
        // Function to check if iframe is a huddle call and inject content script
        function checkForHuddleIframe() {
            const iframes = document.querySelectorAll('iframe[src*="meet.google.com/_/frame"]');
            
            for (const iframe of iframes) {
                // Check if the iframe is visible (huddle is active)
                const rect = iframe.getBoundingClientRect();
                const isVisible = iframe.offsetParent !== null && rect.width > 0 && rect.height > 0;
                
                if (isVisible && !iframeInjected) {
                    console.log("🎯 Found visible Google Meet iframe - Huddle is active!");
                    console.log("📍 Iframe URL:", iframe.src);
                    
                    iframeInjected = true;
                    
                    // Show status on the chat page
                    showChatPageStatus("🎬 Huddle detected - Auto-recording will start soon", 3000);
                    
                    // Try to communicate with the iframe
                    try {
                        iframe.contentWindow.postMessage({ 
                            type: 'HUDDLE_RECORDER_READY', 
                            service: 'gchat' 
                        }, '*');
                    } catch (e) {
                        console.log("⚠️ Could not communicate with iframe:", e);
                    }
                    
                    return true;
                } else if (!isVisible) {
                    iframeInjected = false;
                }
            }
            return false;
        }

        function showChatPageStatus(message, duration = 4000) {
            const existing = document.getElementById('gchat-page-status');
            if (existing) existing.remove();
            
            const status = document.createElement('div');
            status.id = 'gchat-page-status';
            status.textContent = message;
            status.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: rgba(0,0,0,0.9);
                color: #ea4335;
                padding: 10px 15px;
                border-radius: 8px;
                font-family: 'Google Sans', Arial, sans-serif;
                font-size: 13px;
                z-index: 100000;
                font-weight: bold;
                border-left: 4px solid #ea4335;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            `;
            
            document.body.appendChild(status);
            
            setTimeout(() => {
                if (status.parentNode) status.remove();
            }, duration);
        }

        // Set up observer to detect when iframe appears
        const iframeObserver = new MutationObserver(() => {
            checkForHuddleIframe();
        });
        
        iframeObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // Initial check
        checkForHuddleIframe();
        
        // Periodic check
        setInterval(checkForHuddleIframe, 3000);
        
        // Listen for messages from iframe
        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'HUDDLE_RECORDING_STARTED') {
                console.log("📨 Huddle recording started notification from iframe");
                showChatPageStatus("🔴 Huddle recording in progress...");
            }
        });
        
        // Listen for manual start from popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === "startHuddleRecording") {
                console.log("🎬 Manual start requested for huddle");
                const iframe = document.querySelector('iframe[src*="meet.google.com/_/frame"]');
                if (iframe && iframe.contentWindow) {
                    iframe.contentWindow.postMessage({ type: 'START_RECORDING' }, '*');
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: "No huddle iframe found" });
                }
                return true;
            }
        });
    }

    // ==================== GOOGLE MEET ====================
    function gmeetContent() {
        console.log("🔍 Initializing Google Meet content script");
        
        let isInMeeting = false;
        let recordingStarted = false;
        let autoRecordEnabled = false;
        let leaveButtonObserver = null;
        let lastLeaveButtonVisible = false;
        let meetingStarted = false;
        let meetingStartTime = null;
        let meetingEndTime = null;
        let totalMeetingDuration = 0;

        function findLeaveButton() {
            const selectors = [
                'button[aria-label="Leave call"]',
                'button[aria-label*="Leave call"]',
                'div[role="button"][data-tooltip="Leave call"]',
                'div[role="button"][aria-label*="Leave"]',
                'button[jscontroller][jsname][aria-label*="Leave"]',
                '[data-tooltip="Leave call"]',
                '[aria-label="Leave call"]',
                '.VfPpkd-Bz112c-LgbsSe[aria-label*="Leave"]',
                'button[aria-label*="exit"]',
                '[data-is-multi-control="true"][aria-label*="Leave"]',
                'div[role="button"][aria-label*="Leave call"]'
            ];
            
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && isElementVisible(el)) {
                    console.log(`✅ Found leave button with selector: ${selector}`);
                    return el;
                }
            }
            
            const allButtons = document.querySelectorAll('button, div[role="button"]');
            for (const btn of allButtons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const tooltip = btn.getAttribute('data-tooltip') || '';
                const text = btn.textContent || '';
                
                if ((ariaLabel.toLowerCase().includes('leave') || tooltip.toLowerCase().includes('leave') || text.toLowerCase().includes('leave')) &&
                    !ariaLabel.toLowerCase().includes('join')) {
                    if (isElementVisible(btn)) {
                        console.log(`✅ Found leave button by content: ${ariaLabel || tooltip || text}`);
                        return btn;
                    }
                }
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

        function showMeetStatus(message, duration = 4000) {
            const existing = document.getElementById('meet-recorder-status');
            
            if (existing && message.includes("Recording...")) {
                existing.innerHTML = message.replace(/\n/g, '<br>');
                return;
            }
            
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

            if (!message.includes("Recording...")) {
                setTimeout(() => {
                    const currentStatus = document.getElementById('meet-recorder-status');
                    if (currentStatus && !currentStatus.innerHTML.includes("Recording...")) {
                        currentStatus.remove();
                    }
                }, duration);
            }
        }

        function startMeetingTimer() {
            meetingStartTime = Date.now();
            const startTime = new Date(meetingStartTime).toLocaleTimeString();
            console.log(`%c📅 Meeting started at : ${startTime}`, "color: #0f9d58; font-weight: bold;");
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

        function checkMeetingState() {
            const leaveButton = findLeaveButton();
            const leaveVisible = leaveButton && isElementVisible(leaveButton);

            if (leaveVisible && !lastLeaveButtonVisible) {
                console.log("✅ Leave button visible - Meeting joined");
                isInMeeting = true;
                meetingStarted = true;
                startMeetingTimer();

                const startTime = new Date(meetingStartTime).toLocaleTimeString();
                
                if (autoRecordEnabled && !recordingStarted) {
                    console.log("🔄 Auto-record enabled - starting recording in 3 seconds...");
                    showMeetStatus(`📅 Meeting started at: ${startTime}\n🟡 Auto recording starting in 3 seconds...`);

                    if (window.autoRecordTimeout) {
                        clearTimeout(window.autoRecordTimeout);
                    }
                    
                    window.autoRecordTimeout = setTimeout(async () => {
                        if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                            await startAutoRecording();
                        }
                    }, 3000);
                } else {
                    showMeetStatus(`📅 Meeting started at: ${startTime}`, 5000);
                }
            }

            if (!leaveVisible && lastLeaveButtonVisible) {
                console.log("❌ Leave button hidden - Meeting ended");
                isInMeeting = false;
                meetingStarted = false;
                stopMeetingTimer();
                
                if (window.autoRecordTimeout) {
                    clearTimeout(window.autoRecordTimeout);
                    window.autoRecordTimeout = null;
                }
        
                if (recordingStarted) {
                    console.log("🛑 Meeting ended - stopping recording");
                    chrome.runtime.sendMessage({ action: "stopRecordingOnMeetingEnd" });
                    recordingStarted = false;
                }
            }

            lastLeaveButtonVisible = leaveVisible;
            chrome.storage.local.set({ isInMeeting });
        }

        async function startAutoRecording() {
            if (recordingStarted) {
                console.log("⚠️ Auto recording already started, skipping");
                return;
            }
            
            console.log("🚀 Starting auto recording...");

            chrome.storage.local.set({ isRecording: false });

            try {
                const response = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: "autoStartRecording" }, resolve);
                });
                
                if (response && response.success) {
                    recordingStarted = true;            
                    chrome.storage.local.set({ isRecording: true });
                    showMeetStatus("🔴 Auto Recording Started");
                } else {
                    console.log("❌ Failed to start auto recording:", response);
                    recordingStarted = false;
                    showMeetStatus("❌ Auto Recording Failed");
                    setTimeout(() => {
                        if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                            console.log("🔄 Retrying auto recording...");
                            startAutoRecording();
                        }
                    }, 3000);
                }
            } catch (error) {
                console.log("❌ Error starting auto recording:", error);
                recordingStarted = false;
                showMeetStatus("❌ Auto Recording Error");
            }
        }

        async function checkAutoRecordPermission() {
            return new Promise((resolve) => {
                chrome.storage.local.get(['autoRecordPermissions'], (result) => {
                    autoRecordEnabled = result.autoRecordPermissions?.['gmeet'] || false;
                    console.log(`🔐 Auto record enabled for gmeet:`, autoRecordEnabled);
                    resolve(autoRecordEnabled);
                });
            });
        }

        setTimeout(async () => {
            await checkAutoRecordPermission();
            setupLeaveButtonObserver();
            checkInitialMeetingState();
            setInterval(checkMeetingState, 2000);
            
            console.log("🔍 Meet Auto Recorder content script fully loaded with iframe support");
    
            if (autoRecordEnabled) {
                showMeetStatus("✅ Google Meet's Auto Recording Enabled", 3000);
            } else {
                showMeetStatus("✅ Google Meet's Manual Recorder Is Ready", 3000);
            }
        }, 1000);

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

        function checkInitialMeetingState() {
            const leaveButton = findLeaveButton();
            const leaveVisible = leaveButton && isElementVisible(leaveButton);
            
            if (leaveVisible && !isInMeeting) {
                console.log("🔍 Already in meeting - will auto-start recording in 3 seconds");
                isInMeeting = true;
                meetingStarted = true;
                
                if (!meetingStartTime) {
                    startMeetingTimer();
                }
                
                if (autoRecordEnabled && !recordingStarted) {
                    console.log("🚀 Auto-starting recording for existing meeting");
                    showMeetStatus("🟡 Auto recording starting in 3 seconds...", 3000);
                    setTimeout(async () => {
                        await startAutoRecording();
                    }, 3000);
                }
            }
        }

        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === "updateAutoRecordPermission") {
                autoRecordEnabled = message.enabled;
                console.log(`🔄 Auto record permission updated:`, autoRecordEnabled);
                sendResponse({ success: true });
            }

            if (message.action === "manualRecordingStarted") {
                console.log("🎬 Manual recording started - showing timer in Meet");
                recordingStarted = true;
                sendResponse({ success: true });
            }
    
            if (message.action === "manualRecordingStopped") {
                console.log("🛑 Manual recording stopped");
                recordingStarted = false;
                sendResponse({ success: true });
            }

            if (message.action === "autoRecordToggledOn") {
                autoRecordEnabled = message.enabled;
                console.log("🔄 Auto-record toggled ON, checking if we're in a meeting...");
                if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                    startAutoRecording();
                }
                sendResponse({ success: true });
            }

            if (message.action === "checkMeetingStatus") {
                sendResponse({ 
                    isInMeeting, 
                    recording: recordingStarted, 
                    autoRecordEnabled
                });
            }

            if (message.action === "autoStopRecording") {
                recordingStarted = false;
                sendResponse({ success: true });
            }

            if (message.action === "showMeetStatus") {
                showMeetStatus(message.message, message.duration || 4000);
                sendResponse({ success: true });
            }
            
            if (message.action === "updateMeetTimer") {
                const status = document.getElementById('meet-recorder-status');
                if (status && status.textContent.includes('Recording')) {
                    status.textContent = `🔴 Recording... ${message.time}`;
                } else if (isInMeeting && recordingStarted) {
                    showMeetStatus(`🔴 Recording... ${message.time}`);
                }
                sendResponse({ success: true });
            }

            if (message.action === "recordingCompleted") {
                recordingStarted = false;
                showMeetStatus("✅ Recording Completed & Downloaded");
                sendResponse({ success: true });
            }
            
            return true;
        });
    }

    function setupIframeDetection() {
        console.log("🔍 Setting up iframe detection for Google Meet");
        
        const iframeObserver = new MutationObserver((mutations) => {
            const iframe = document.querySelector('iframe[src*="meet.google.com/_/frame"]');
            if (iframe && iframe.contentWindow) {
                console.log("✅ Google Meet iframe detected");
                
                try {
                    iframe.contentWindow.postMessage({ type: 'MEET_RECORDER_READY' }, '*');
                    window.postMessage({ type: 'MEET_RECORDER_INIT', service: 'gmeet' }, '*');
                } catch (e) {
                    console.log("⚠️ Could not communicate with iframe:", e);
                }
                
                iframeObserver.disconnect();
            }
        });
        
        iframeObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        const existingIframe = document.querySelector('iframe[src*="meet.google.com/_/frame"]');
        if (existingIframe && existingIframe.contentWindow) {
            console.log("✅ Google Meet iframe already exists");
            try {
                window.postMessage({ type: 'MEET_RECORDER_INIT', service: 'gmeet' }, '*');
            } catch (e) {
                console.log("⚠️ Could not communicate with iframe:", e);
            }
        }
    }

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'MEET_RECORDER_INIT' && event.data.service === 'gmeet') {
            console.log("📨 Received initialization message in iframe");
            gmeetContent();
        }
    });

    function teamsContent() {
        console.log("🔍 Initializing Microsoft Teams content script");
    }

    function zoomContent() {
        console.log("🔍 Initializing Zoom content script");
    }
})();