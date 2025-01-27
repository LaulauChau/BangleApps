Bangle.loadWidgets();
Bangle.drawWidgets();

let appSettings;

function logAction(message) {
  const logFile = "clinikali.log.txt";
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  require("Storage").open(logFile, "a").write(logEntry);
}

function loadAppSettings() {
  appSettings = require("Storage").readJSON("clinikali.json", 1) || {};
  let settingsChanged = false;

  if (!appSettings.localeOffset) {
    settingsChanged = true;
    appSettings.locale = 1;
  }

  if (!appSettings.pid) {
    settingsChanged = true;
    appSettings.pid = "05"; // Default PID
  }

  if (!appSettings.record) {
    settingsChanged = true;
    appSettings.record = ["accel", "hrm", "baro"];
  }

  if (!appSettings.period) {
    settingsChanged = true;
    appSettings.period = 1;
  }

  if (typeof appSettings.recording === "undefined") {
    settingsChanged = true;
    appSettings.recording = false;
  }

  if (settingsChanged) {
    require("Storage").writeJSON("clinikali.json", appSettings);
  }

  return appSettings;
}

function updateAppSettings() {
  require("Storage").writeJSON("clinikali.json", appSettings);
  if (WIDGETS.recorder) {
    WIDGETS.recorder.reload();
  }
}

function generateFilename() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10);
  return `${appSettings.pid}_${dateStr}.csv`;
}

function extractFileNumber(filename) {
  if (!filename) return "";

  const parts = filename.split("_");
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : filename;
}

function toggleRecorder(name) {
  const index = appSettings.record.indexOf(name);

  if (index === -1) {
    appSettings.record.push(name);
    logAction(`Sensor ${name} enabled`);
  } else {
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
    updateAppSettings();
  }

  const sensorMenu = {
    "": { title: "Sensors" },
    Accelerometer: {
      value: appSettings.record.includes("accel"),
      onchange: () => toggleRecorder("accel"),
    },
    "Heart Rate": {
      value: appSettings.record.includes("hrm"),
      onchange: () => toggleRecorder("hrm"),
    },
  };

  if (Bangle.getPressure) {
    sensorMenu["Temperature"] = {
      value: appSettings.record.includes("baro"),
      onchange: () => toggleRecorder("baro"),
    };
  }

  sensorMenu["< Back"] = () => showMainMenu();

  return E.showMenu(sensorMenu);
}

function showMainMenu() {
  const mainMenu = {
    "": { title: "Clinikali" },
    "< Back": () => load(),
    Record: {
      value: !!appSettings.recording,
      onchange: (newValue) => {
        setTimeout(() => {
          E.showMenu();

          if (newValue) {
            const newFilename = generateFilename();
            appSettings.file = newFilename;
            updateAppSettings();
            logAction(`Created new file: ${newFilename}`);
          }

          WIDGETS.recorder.setRecording(newValue).then(() => {
            loadAppSettings();
            logAction(`Recording ${newValue ? "started" : "stopped"}`);
            showMainMenu();
          });
        }, 1);
      },
    },
    "View Files": () => viewFiles(),
    Sensors: () => showSensorMenu(),
    "Time Period": {
      value: appSettings.period || 1,
      min: 1,
      max: 120,
      step: 1,
      format: (value) => `${value} Hz`,
      onchange: (newValue) => {
        appSettings.recording = false;
        appSettings.period = newValue;
        logAction(`Sampling period changed to ${newValue}Hz`);
        updateAppSettings();
      },
    },
  };

  return E.showMenu(mainMenu);
}

function sendCsvFile(filename) {
  const content = require("Storage").read(filename);

  if (!content) {
    logAction(`Failed to read file: ${filename}`);
    return;
  }

  Bluetooth.println(
    JSON.stringify({
      t: "file",
      n: filename,
      c: content,
      timestamp: Date.now(),
    }),
  );

  logAction(`Sent file: ${filename}`);
}

function connectToAndroid(filename) {
  NRF.connect("e8:f7:91:fb:61:db")
    .then(() => {
      logAction("Connected to Android");
      sendCsvFile(filename);
    })
    .catch(() => {
      logAction("Failed to connect to Android");

      // Only reconnect if between midnight and 1am
      const now = new Date();
      const hours = now.getHours();

      if (hours >= 0 && hours < 1) {
        setTimeout(() => connectToAndroid(filename), 5000);
      }
    });
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
    Send: () => {
      connectToAndroid(filename);
    },
    "< Back": () => viewFiles(),
  });
}

function viewFiles() {
  const fileMenu = {
    "": { title: "Files" },
  };

  let filesFound = false;

  require("Storage")
    .list(/\d+_\d+-\d+-\d+\.csv/, { sf: true })
    .reverse()
    .forEach((filename) => {
      filesFound = true;
      fileMenu[extractFileNumber(filename)] = () => viewFile(filename);
    });

  if (!filesFound) {
    fileMenu["No Files found"] = () => {};
  }

  fileMenu["< Back"] = () => showMainMenu();

  return E.showMenu(fileMenu);
}

// Initialize app
loadAppSettings();
showMainMenu();
