Bangle.loadWidgets();
Bangle.drawWidgets();

// Enable Bluetooth Low Energy
NRF.wake();

let appSettings;

function logAction(message) {
  const logFile = "clinikali.log.txt";
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;

  // Append to log file
  const file = require("Storage").open(logFile, "a");
  file.write(logEntry);
}

function loadAppSettings() {
  appSettings = require("Storage").readJSON("clinikali.json", 1) || {};
  let settingsChanged = false;

  // Initialize PID if not set
  if (!appSettings.pid) {
    settingsChanged = true;
    appSettings.pid = "05"; // Default PID
  }

  // Initialize record array if not set
  if (!appSettings.record) {
    settingsChanged = true;
    appSettings.record = ["accel", "hrm", "baro"];
  }

  // Initialize period if not set
  if (!appSettings.period) {
    settingsChanged = true;
    appSettings.period = 1;
  }

  // Initialize recording status if not set
  if (typeof appSettings.recording === "undefined") {
    settingsChanged = true;
    appSettings.recording = false;
  }

  if (settingsChanged) {
    require("Storage").writeJSON("clinikali.json", appSettings);
  }
  return appSettings;
}

loadAppSettings();

function updateAppSettings() {
  require("Storage").writeJSON("clinikali.json", appSettings);

  if (WIDGETS.recorder) {
    WIDGETS.recorder.reload();
  }
}

function generateFilename() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10); // Gets YYYY-MM-DD
  const baseFilename = `${appSettings.pid}_${dateStr}`;

  // Check existing files with same base name
  const files = require("Storage").list(
    new RegExp(`^${baseFilename}_[a-z]\\.csv$`),
  );

  if (files.length === 0) {
    return `${baseFilename}_a.csv`;
  }

  // Find the last letter used
  const lastFile = files.sort().pop();
  const lastLetter = lastFile.charAt(lastFile.length - 5);
  const nextLetter = String.fromCharCode(lastLetter.charCodeAt(0) + 1);

  return `${baseFilename}_${nextLetter}.csv`;
}

function extractFileNumber(filename) {
  if (!filename) {
    return "";
  }

  const parts = filename.split("_");

  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1]} ${parts[2].charAt(0)}`; // Returns "PID DATE LETTER"
  }

  return filename;
}

function toggleRecorder(name) {
  // No need to load settings again as we already have them in appSettings
  const index = appSettings.record.indexOf(name);

  if (index === -1) {
    // Add recorder
    appSettings.record.push(name);
    logAction(`Sensor ${name} enabled`);
  } else {
    // Remove recorder
    appSettings.record.splice(index, 1);
    logAction(`Sensor ${name} disabled`);
  }

  updateAppSettings();
  showSensorMenu();
}

function showSensorMenu() {
  const appSettings = loadAppSettings();
  if (!appSettings.record) {
    appSettings.record = ["accel", "hrm", "baro"];
    updateAppSettings(appSettings);
  }

  const sensorMenu = {
    "": { title: "Sensors" },
  };

  // Add checkbox menu items for each sensor
  sensorMenu["Accelerometer"] = {
    value: appSettings.record.includes("accel"),
    onchange: () => toggleRecorder("accel"),
  };

  sensorMenu["Heart Rate"] = {
    value: appSettings.record.includes("hrm"),
    onchange: () => toggleRecorder("hrm"),
  };

  if (Bangle.getPressure) {
    sensorMenu["Temperature"] = {
      value: appSettings.record.includes("baro"),
      onchange: () => toggleRecorder("baro"),
    };
  }

  sensorMenu["< Back"] = () => {
    showMainMenu();
  };

  return E.showMenu(sensorMenu);
}

function showMainMenu() {
  const mainMenu = {
    "": { title: "Clinikali" },
    "< Back": () => {
      load();
    },
    Record: {
      value: !!appSettings.recording,
      onchange: (newValue) => {
        setTimeout(() => {
          E.showMenu();

          if (newValue) {
            // Generate new filename when starting recording
            const newFilename = generateFilename();
            appSettings.file = newFilename;
            updateAppSettings();
            logAction(`Created new file: ${newFilename}`);
            // You'll need to pass this filename to your recorder widget
          }

          WIDGETS.recorder.setRecording(newValue).then(() => {
            loadAppSettings();
            logAction(`Recording ${newValue ? "started" : "stopped"}`);
            showMainMenu();
          });
        }, 1);
      },
    },
    "View Files": () => {
      viewFiles();
    },
    Sensors: () => {
      showSensorMenu();
    },
    "Time Period": {
      value: appSettings.period || 1,
      min: 1,
      max: 120,
      step: 1,
      format: (value) => `${value} Hz`,
      onchange: (newValue) => {
        appSettings.recording = false; // stop recording if we change anything
        appSettings.period = newValue;
        logAction(`Sampling period changed to ${newValue}Hz`);
        updateAppSettings();
      },
    },
  };

  return E.showMenu(mainMenu);
}

function viewFile(filename) {
  E.showMenu({
    "": { title: `File ${extractFileNumber(filename)}` },
    Delete: () => {
      E.showPrompt("Delete File?").then((shouldDelete) => {
        if (shouldDelete) {
          require("Storage").erase(filename);
          logAction(`Deleted file: ${filename}`);
          viewFiles();
        } else {
          viewFile(filename);
        }
      });
    },
    "< Back": () => {
      viewFiles();
    },
  });
}

function viewFiles() {
  const fileMenu = {
    "": { title: "Files" },
  };

  let filesFound = false;

  require("Storage")
    .list(/^P\d{3}_\d{4}-\d{2}-\d{2}_[a-z]\.csv$/, { sf: true }) // Changed pattern
    .reverse()
    .forEach((filename) => {
      filesFound = true;
      fileMenu[extractFileNumber(filename)] = () => {
        viewFile(filename);
      };
    });

  if (!filesFound) {
    fileMenu["No Files found"] = () => {};
  }

  fileMenu["< Back"] = () => {
    showMainMenu();
  };

  return E.showMenu(fileMenu);
}

showMainMenu();
