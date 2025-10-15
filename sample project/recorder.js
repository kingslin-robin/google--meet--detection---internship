// FIXED RECORDER - RESOLVED activeTab PERMISSION ERROR
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let timerInterval;
let recordingStartTime;
let isAutoRecord = false;
let originalAudioContext = null;
let muteCheckInterval = null;
let autoRecordEnabled = false;
let globalMicStream = null; 
let globalMicGainNode = null; 
let currentTabId = null;

console.log("🎬 GMeet Recorder tab loaded");

// SAFE DOM HELPER FUNCTION
function safeSetStatus(message) {
  const statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.textContent = message;
  }
}

// Function to sync toggle state
async function syncToggleState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoRecordPermission'], (result) => {
      autoRecordEnabled = result.autoRecordPermission || false;
      console.log("🔄 Recorder: Auto record permission:", autoRecordEnabled);
      updateToggleDisplay();
      resolve(autoRecordEnabled);
    });
  });
}

// Function to update the toggle
function updateToggleDisplay() {
  const statusElement = document.getElementById("status");
  const indicatorElement = document.getElementById("autoRecordIndicator");
  
  if (indicatorElement) {
    indicatorElement.textContent = `Auto Record: ${autoRecordEnabled ? 'ON' : 'OFF'}`;
    indicatorElement.className = `auto-record-indicator ${autoRecordEnabled ? 'auto-on' : 'auto-off'}`;
  }
  
  if (statusElement) {
    if (isRecording) {
      statusElement.textContent = autoRecordEnabled ? "🟢 Auto Recording..." : "🟢 Recording...";
    } else {
      statusElement.textContent = autoRecordEnabled ? "✅ Auto Record Enabled" : "✅ Ready to record...";
    }
  }
}

// Add tab closure detection
function setupTabClosureDetection(tabId) {
  const tabCheckInterval = setInterval(async () => {
    if (!isRecording) {
      clearInterval(tabCheckInterval);
      return;
    }
    
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        console.log("❌ Source tab closed - stopping recording");
        stopRecording();
        clearInterval(tabCheckInterval);
      }
    } catch (error) {
      console.log("❌ Source tab closed or inaccessible - stopping recording");
      stopRecording();
      clearInterval(tabCheckInterval);
    }
  }, 2000);
}

// To listen for toggle state changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.autoRecordPermission) {
    autoRecordEnabled = changes.autoRecordPermission.newValue;
    console.log("🔄 Recorder: Toggle state updated to:", autoRecordEnabled);
    updateToggleDisplay();
  }
});

// BROADCAST FUNCTIONS FOR MEET TAB
function broadcastToMeetTab(message) {
    chrome.runtime.sendMessage({
        action: "showMeetStatus", 
        message: message
    });
}

function broadcastTimerUpdate(timeStr) {
    chrome.runtime.sendMessage({
        action: "updateMeetTimer",
        time: timeStr
    });
}

// 🆕 FIXED: Proper async message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Recorder received:", message.action);

  const handleAsync = async () => {
    try {
      if (message.action === "startRecording") {
        isAutoRecord = message.autoRecord || false;
        currentTabId = message.tabId;
        console.log("🎬 Starting recording, auto mode:", isAutoRecord, "tabId:", currentTabId);
        await startRecording(message.tabId);
        sendResponse({ success: true });
      }
      else if (message.action === "stopRecording") {
        if (message.forceAutoDownload) {
          isAutoRecord = true;
        }
        console.log("🛑 Stopping recording");
        stopRecording();
        sendResponse({ success: true });
      }
      else {
        sendResponse({ success: false, reason: "unknown_action" });
      }
    } catch (error) {
      console.error("❌ Error handling message:", error);
      sendResponse({ success: false, error: error.message });
    }
  };

  handleAsync();
  return true; // 🆕 Keep message channel open for async response
});

// 🆕 FIXED: Improved recording start with activeTab permission handling
async function startRecording(tabId) {
  console.log("🎬 Starting recording for tab:", tabId);

  await syncToggleState();

  if (isRecording) {
    console.log("⚠️ Already recording");
    return;
  }

  try {
    safeSetStatus("🟡 Starting recording...");
    broadcastToMeetTab("🔴 Recording started...");
    
    // 🆕 ADD 1 SECOND DELAY TO ENSURE STABILITY
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 🆕 FIXED: Use chrome.tabs.get to validate tab before capture
    const tab = await new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Tab not accessible: ${chrome.runtime.lastError.message}`));
        } else if (!tab) {
          reject(new Error("Tab not found"));
        } else {
          resolve(tab);
        }
      });
    });

    console.log("✅ Source tab validated:", tab.url);

    const tabStream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({
        audio: true,
        video: true,
        audioConstraints: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: tabId.toString(), // 🆕 Ensure string format
          }
        },
        videoConstraints: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: tabId.toString(), // 🆕 Ensure string format
            minWidth: 1280,
            minHeight: 720,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30
          }
        }
      }, (stream) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Tab capture failed: ${chrome.runtime.lastError.message}`));
        } else if (!stream) {
          reject(new Error("No tab stream returned - check activeTab permission"));
        } else {
          resolve(stream);
        }
      });
    });

    console.log("✅ Tab stream captured. Audio tracks:", tabStream.getAudioTracks().length, 
                "Video tracks:", tabStream.getVideoTracks().length);

    const audioContext = new AudioContext();
    const recordingDestination = audioContext.createMediaStreamDestination();
    
    const meetAudioSource = audioContext.createMediaStreamSource(
      new MediaStream(tabStream.getAudioTracks())
    );
    
    const splitter = audioContext.createChannelSplitter(2);
    const recordingMerger = audioContext.createChannelMerger(2);
    const playbackMerger = audioContext.createChannelMerger(2);
    
    meetAudioSource.connect(splitter);
    
    splitter.connect(playbackMerger, 0, 0);
    splitter.connect(playbackMerger, 1, 1);
    playbackMerger.connect(audioContext.destination);
    
    splitter.connect(recordingMerger, 0, 0);
    splitter.connect(recordingMerger, 1, 1);
    
    // Get microphone audio for recording
    try {
      console.log("🎤 Requesting microphone access...");
      globalMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: false
      });

      console.log("✅ Microphone access granted");
      const micSource = audioContext.createMediaStreamSource(globalMicStream);
      
      globalMicGainNode = audioContext.createGain();
      micSource.connect(globalMicGainNode);
      
      globalMicGainNode.gain.value = 0; // Start muted
      globalMicGainNode.connect(recordingMerger, 0, 0);
      globalMicGainNode.connect(recordingMerger, 0, 1);
      
      console.log("✅ Microphone connected to recording (initially muted)");
      
    } catch (micError) {
      console.error("❌ Microphone access denied:", micError);
    }

    recordingMerger.connect(recordingDestination);
    
    console.log("✅ Audio setup: Meet audio → Recording + Playback, Microphone → Recording only");

    // FIXED MUTE DETECTION FUNCTION
    const updateMicrophoneMute = async () => {
      try {
        const response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: "getMuteStatus" }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ isMuted: true });
            } else {
              resolve(response || { isMuted: true });
            }
          });
        });

        if (globalMicGainNode) {
          if (response.isMuted) {
            globalMicGainNode.gain.value = 0;
            console.log("🔇 Microphone muted in recording (Meet is muted)");
          } else {
            globalMicGainNode.gain.value = 1.0;
            console.log("🎤 Microphone UNMUTED in recording (Meet is unmuted)");
          }
        } else {
          console.log("⚠️ No mic gain node available for mute control");
        }
      } catch (error) {
        console.log("⚠️ Could not check mute status, keeping microphone muted");
        if (globalMicGainNode) globalMicGainNode.gain.value = 0;
      }
    };

    // Check mute status every 2 seconds
    muteCheckInterval = setInterval(updateMicrophoneMute, 2000);
    updateMicrophoneMute(); // Initial check

    // Create final recording stream: video + mixed audio
    const videoTrack = tabStream.getVideoTracks()[0];
    const mixedAudioTrack = recordingDestination.stream.getAudioTracks()[0];

    // Track closure detection
    const sourceVideoTrack = tabStream.getVideoTracks()[0];
    const sourceAudioTrack = tabStream.getAudioTracks()[0];

    if (sourceVideoTrack) {
      sourceVideoTrack.onended = () => {
        console.log("❌ Source video track ended - Meet tab closed");
        stopRecording();
      };
    }

    if (sourceAudioTrack) {
      sourceAudioTrack.onended = () => {
        console.log("❌ Source audio track ended - Meet tab closed");
        stopRecording();
      };
    }

    if (!videoTrack) {
      throw new Error("No video track available from tab capture");
    }

    if (!mixedAudioTrack) {
      throw new Error("No audio track available after mixing");
    }

    const finalStream = new MediaStream([videoTrack, mixedAudioTrack]);
    console.log("✅ Final recording stream created with dual audio paths");

    // Choose MIME type
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus', 
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];
    let supportedType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

    console.log("🎥 Using MIME type:", supportedType);

    mediaRecorder = new MediaRecorder(finalStream, {
      mimeType: supportedType,
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 128000
    });

    recordedChunks = [];
    isRecording = true;
    recordingStartTime = Date.now();
    originalAudioContext = audioContext;

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
        console.log("📦 Data chunk:", e.data.size, "bytes");
      }
    };

    mediaRecorder.onstop = () => {
      console.log("🛑 Recording stopped, total chunks:", recordedChunks.length);
      stopTimer();
      downloadRecording();
      cleanup();
    };

    mediaRecorder.onerror = e => {
      console.error("❌ MediaRecorder error:", e);
      safeSetStatus("❌ Recording error");
      cleanup();
    };

    mediaRecorder.start(1000);
    updateToggleDisplay();
    startTimer();

    setupTabClosureDetection(tabId);

    await chrome.storage.local.set({ isRecording: true, recordingStartTime });
    chrome.runtime.sendMessage({ action: "recordingStarted" });
    
    console.log("✅ Recording started successfully!");
    console.log("🎧 Meet audio is now audible in the tab while recording");
    console.log("🎤 Recording follows Google Meet mute/unmute status");

  } catch (err) {
    console.error("❌ Recording start failed:", err);
    safeSetStatus("❌ Recording failed: " + err.message);
    broadcastToMeetTab("❌ Recording failed");
    
    // 🆕 Clean up on failure
    cleanup();
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    console.log("🛑 Stopping recording...");
    broadcastToMeetTab("🟡 Stopping recording...");
    mediaRecorder.stop();
  } else {
    console.log("⚠️ No active recording to stop");
  }
}

function startTimer() {
  let seconds = 0;
  const timerEl = document.getElementById("timer");
  if (!timerEl) return;
  
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    seconds++;
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    const timeStr = `${mins}:${secs}`;
    timerEl.textContent = timeStr;
    chrome.storage.local.set({ recordingTime: timeStr });
    chrome.runtime.sendMessage({ action: "timerUpdate", time: timeStr });
    broadcastTimerUpdate(timeStr);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function downloadRecording() {
  if (!recordedChunks.length) {
    console.error("❌ No recording data available");
    safeSetStatus("❌ No recording data");
    broadcastToMeetTab("❌ Recording failed: No data");
    return;
  }

  console.log("💾 Preparing download, total data:", recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0), "bytes");

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
  const filename = `gmeet-recording-${timestamp}.webm`;

  chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn("⚠️ Chrome download failed, using fallback:", chrome.runtime.lastError);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      console.log("✅ AUTO-DOWNLOAD started with ID:", downloadId);
      broadcastToMeetTab("✅ Recording saved!");
    }
    safeSetStatus("✅ Recording Auto-Downloaded!");
  });
}

function cleanup() {
  console.log("🧹 Cleaning up recording resources");
  isRecording = false;
  stopTimer();

  // Clear mute check interval
  if (muteCheckInterval) {
    clearInterval(muteCheckInterval);
    muteCheckInterval = null;
  }

  // Close audio context
  if (originalAudioContext) {
    originalAudioContext.close().catch(e => console.log("AudioContext close error:", e));
    originalAudioContext = null;
  }

  // Clean up global mic gain node
  if (globalMicGainNode) {
    globalMicGainNode.disconnect();
    globalMicGainNode = null;
  }

  if (mediaRecorder?.stream) {
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
  }

  if (globalMicStream) {
    globalMicStream.getTracks().forEach(track => track.stop());
    globalMicStream = null;
  }
  
  recordedChunks = [];
  
  chrome.storage.local.set({ 
    isRecording: false,
    recordingStoppedByTabClose: true 
  }, () => {
    chrome.storage.local.remove(['recordingTime', 'recordingStartTime']);
    chrome.runtime.sendMessage({ action: "recordingStopped" });
  });

  broadcastToMeetTab("✅ Recording Stopped and Auto-Downloaded");
  safeSetStatus("✅ Recording completed");

  console.log("🤖 Closing recorder tab in 3 seconds");
  setTimeout(() => window.close(), 3000);
}

// Keep tab alive for auto-recording
setInterval(() => { 
  if (isRecording) console.log("💓 Recorder alive -", document.getElementById("timer")?.textContent); 
}, 30000);

window.addEventListener('beforeunload', (event) => {
  if (isRecording && recordedChunks.length > 0) {
    console.log("🚨 Recorder tab closing during recording");
    const recordingData = {
      timestamp: Date.now(),
      chunkCount: recordedChunks.length
    };
    sessionStorage.setItem('pendingRecording', JSON.stringify(recordingData));
    event.preventDefault();
    event.returnValue = '';
    return '';
  }
});

window.addEventListener('unload', () => {
  const pendingRecording = sessionStorage.getItem('pendingRecording');
  if (pendingRecording && recordedChunks.length > 0) {
    console.log("✅ User confirmed Leave - AUTO-DOWNLOADING recording");
    chrome.storage.local.set({ 
      recordingStoppedByTabClose: true,
      isRecording: false 
    });
    chrome.runtime.sendMessage({ action: "recordingStopped" });
    chrome.runtime.sendMessage({
      action: "showMeetStatus", 
      message: "✅ Recording Stopped and Auto-Downloaded"
    });
    
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
    const filename = `gmeet-recording-${timestamp}.webm`;
    
    chrome.downloads.download({ 
      url: url, 
      filename: filename, 
      saveAs: false
    });
    
    sessionStorage.removeItem('pendingRecording');
  }
});
