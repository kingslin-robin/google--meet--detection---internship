// FOR MEETING DETECTION
(function () {
  let meetingStarted = false;
  let startTime = null;
  let endTime = null;

  // Utility: get current time as hh:mm:ss
  function getCurrentTime() {
    return new Date().toLocaleTimeString();
  }

  // Utility: format duration (ms → hh:mm:ss)
  function formatDuration(ms) {
    let totalSeconds = Math.floor(ms / 1000);
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  // Function: when meeting starts
  function meetingStart() {
    if (!meetingStarted) {
      meetingStarted = true;
      startTime = new Date();
      console.log(
        `%c📢 Meeting Started at ${getCurrentTime()}`,
        "color: green; font-weight: bold;"
      );
    }
  }

  // Function: when meeting ends
  function meetingEnd() {
    if (meetingStarted) {
      endTime = new Date();
      meetingStarted = false;
      console.log(
        `%c📢 Meeting Ended at ${getCurrentTime()}`,
        "color: red; font-weight: bold;"
      );
      if (startTime && endTime) {
        console.log(
          `%c⏱ Meeting Duration: ${formatDuration(endTime - startTime)}`,
          "color: blue; font-weight: bold;"
        );
      }
    }
  }

  // MutationObserver: Watch for "Leave call" button disappearance as signal
  const observer = new MutationObserver(() => {
    const leaveButton = document.querySelector(
      '[aria-label^="Leave call"], [aria-label^="Leave meeting"]'
    );
    if (leaveButton) {
      meetingStart(); // Meeting in progress
    } else {
      meetingEnd(); // Left or ended
    }
  });

  // Observe the whole document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log(
    "%c✅ Meeting tracker initialized. Waiting for changes...",
    "color: orange; font-weight: bold;"
  );
})();