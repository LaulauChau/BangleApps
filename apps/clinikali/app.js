Bangle.loadWidgets();
Bangle.drawWidgets();
NRF.wake();

/**
 * @typedef {Object} AppSettings
 * @property {string} file - Log file name
 * @property {number} interval - Recording interval in seconds
 * @property {string[]} metrics - Array of active metrics
 * @property {boolean} recording - Recording status
 */

/**
 * @typedef {Object} MenuItem
 * @property {string} [title] - Menu title
 * @property {Function} [format] - Value formatter
 * @property {number} [max] - Maximum value
 * @property {number} [min] - Minimum value
 * @property {onchange} [onchange] - Change event handler
 * @property {number} [step] - Step value
 * @property {boolean} [value] - Current value

/**
 * @returns {AppSettings}
 */
function loadAppSettings() {
  const defaultSettings = {
    file: "clinikali.log0.csv",
    interval: 1,
    metrics: ["accel", "hrm", "baro"],
    recording: false,
  };

  const storedSettings = require("Storage").readJSON("clinikali.json", 1) ?? {};
  const settings = { ...defaultSettings, ...storedSettings };

  require("Storage").write("clinikali.json", settings);
  return settings;
}

/**
 * @param {AppSettings} settings
 */
function updateAppSettings(settings) {
  require("Storage").writeJSON("clinikali.json", settings);

  if (WIDGETS.recorder) {
    WIDGETS.recorder.reload();
  }
}

/**
 * @param {string} filename
 * @returns {string}
 */
function extractFileNumber(filename) {
  const matches = filename.match(/^clinikali\.log(.*)\.csv$/);

  return matches ? matches[1] : "0";
}

/**
 * @param {string} name
 * @param {AppSettings} settings
 * @returns {AppSettings}
 */
function toggleSensor(name, settings) {
  return {
    ...settings,
    metrics: settings.metrics.includes(name)
      ? settings.metrics.filter((metric) => metric !== name)
      : [...settings.metrics, name],
  };
}

/**
 * @param {AppSettings} settings
 * @returns {Object}
 */
function createSensorMenu(settings) {
  return {
    "": { title: /*LANG*/ "Sensors" },
    /*LANG*/ Accelerometer: {
      onchange: () => {
        const newSettings = toggleSensor("accel", settings);

        updateAppSettings(newSettings);
        showSensorMenu(newSettings);
      },
      value: settings.metrics.includes("accel"),
    },
    /*LANG*/ "Heart Rate": {
      onchange: () => {
        const newSettings = toggleSensor("hrm", settings);

        updateAppSettings(newSettings);
        showSensorMenu(newSettings);
      },
      value: settings.metrics.includes("hrm"),
    },
    ...(Bangle.getPressure && {
      /*LANG*/ Temperature: {
        onchange: () => {
          const newSettings = toggleSensor("baro", settings);

          updateAppSettings(newSettings);
          showSensorMenu(newSettings);
        },
        value: settings.metrics.includes("baro"),
      },
    }),
    "< Back": () => showMainMenu(settings),
  };
}

/**
 * @param {AppSettings} settings
 */
function showSensorMenu(settings) {
  const menu = createSensorMenu(settings);

  E.showMenu(menu);
}

/**
 * @param {AppSettings} settings
 * @returns {Object.<string, MenuItem>}
 */
function createMainMenu(settings) {
  return {
    "": { title: "Clinikali" },
    "< Back": () => load(),
    /*LANG*/ "Toggle Recording": {
      onchange: (newValue) => {
        setTimeout(() => {
          E.showMenu();

          WIDGETS.recorder.setRecording(newValue).then(() => {
            const newSettings = loadAppSettings();

            showMainMenu(newSettings);
          });
        }, 1);
      },
      value: settings.recording,
    },
    /*LANG*/ "Select Sensors": () => showSensorMenu(settings),
    /*LANG*/ "View Files": viewFiles,
    /*LANG*/ "Set Interval": {
      format: (value) => `${value}s`,
      onchange: (newValue) => {
        const newSettings = {
          ...settings,
          interval: newValue,
          recording: false,
        };

        updateAppSettings(newSettings);
      },
      max: 120,
      min: 1,
      step: 1,
      value: settings.interval ?? 1,
    },
  };
}

/**
 * @param {AppSettings} settings
 */
function showMainMenu(settings) {
  const menu = createMainMenu(settings);

  E.showMenu(menu);
}

/**
 * @param {string} filename
 */
function sendFileData(filename) {
  const cleanFilename = filename.replace(" (StorageFile)", "");
  const file = require("Storage").open(cleanFilename, "r");

  if (!file) {
    E.showMessage(/*LANG*/ "File not found");
    setTimeout(() => viewFile(filename), 2000);
    return;
  }

  const content = file.read();
  const totalSize = content.length;

  NRF.setConnectionInterval(7.5);
  NRF.setTxPower(4);

  E.showMessage(/*LANG*/ "Sending...");

  const CHUNK_SIZE = 768;
  let position = 0;
  let lastProgressUpdate = 0;

  function sendChunk() {
    if (position >= totalSize) {
      Bluetooth.println("END");
      E.showMessage(/*LANG*/ "Sent");
      setTimeout(() => viewFile(filename), 2000);
      return;
    }

    const progress = Math.floor((position / totalSize) * 100);

    if (progress >= lastProgressUpdate + 5) {
      E.showMessage(/*LANG*/ `Sending... ${progress}%`);
      lastProgressUpdate = progress;
    }

    const chunk = content.slice(position, position + CHUNK_SIZE);
    Bluetooth.write(chunk);

    position += CHUNK_SIZE;
    setTimeout(sendChunk, 5);
  }

  Bluetooth.println("START:" + cleanFilename);
  sendChunk();
}

/**
 * @param {string} filename
 */
function viewFile(filename) {
  E.showMenu({
    "": { title: /*LANG*/ `File ${extractFileNumber(filename)}` },
    /*LANG*/ "Send Data": () => {
      sendFileData(filename);
    },
    /*LANG*/ Delete: () => {
      E.showPrompt(/*LANG*/ "Delete file?").then((shouldDelete) => {
        if (shouldDelete) {
          require("Storage").erase(filename);
          viewFiles();
        } else {
          viewFile(filename);
        }
      });
    },
    "< Back": viewFiles,
  });
}

function viewFiles() {
  const files = require("Storage")
    .list(/^clinikali\.log(.*)\.csv$/, { sf: true })
    .reverse();

  const fileMenu = {
    "": { title: /*LANG*/ "Files" },
    ...(files.length === 0 && { /*LANG*/ "No files": () => {} }),
    ...Object.fromEntries(
      files.map((filename) => [
        extractFileNumber(filename),
        () => viewFile(filename),
      ]),
    ),
    "< Back": () => showMainMenu(loadAppSettings()),
  };

  E.showMenu(fileMenu);
}

function init() {
  try {
    console.log("Loading settings...");
    const initialSettings = loadAppSettings();
    console.log("Settings loaded:", initialSettings);

    showMainMenu(initialSettings);
  } catch (error) {
    console.log("Error:", error.toString());
    E.showMessage("Error: " + error.toString());
    setTimeout(load, 2000);
  }
}

init();
