Bangle.setBarometerPower(true, "clinikali");
Bangle.setHRMPower(true, "clinikali");

Bangle.loadWidgets();
Bangle.drawWidgets();

/**
 * @typedef {Object} AppSettings
 * @property {string[]} enabledSensors
 * @property {string} file
 * @property {boolean} isRecording
 * @property {number} localeOffset
 * @property {string} macAddress
 * @property {string} pid
 * @property {number} timePeriod
 */

/**
 * @param {string} message
 * @param {"info" | "warn" | "error"} severity
 *
 * @returns {void}
 */
export function logMessage(message, severity) {
  const timestamp = new Date()
    .toISOString()
    .replace("T", " - ")
    .replace("Z", "");

  const logEntry = `${timestamp} [${severity}] ${message}\n`;

  console.log(logEntry);

  return require("Storage").open("clinikali.log.txt", "a").write(logEntry);
}

/**
 * @returns {AppSettings}
 */
export function getAppSettings() {
  /** @type {AppSettings} */
  const defaultSettings = {
    enabledSensors: ["accel", "baro", "hrm"],
    file: "",
    isRecording: false,
    localeOffset: 1,
    macAddress: "E8:F7:91:FB:61:DB",
    pid: "05",
    timePeriod: 1,
  };

  const appSettings = require("Storage").readJSON("clinikali.json", 1) || {};

  return Object.assign({}, defaultSettings, appSettings);
}

/**
 * @param {{ [key: string]: unknown }} settings
 *
 * @returns {void}
 */
export function updateAppSettings(settings) {
  const currentSettings = getAppSettings();

  require("Storage").writeJSON(
    "clinikali.json",
    Object.assign(currentSettings, settings),
  );
  logMessage("[updateAppSettings] Settings updated", "info");

  if (WIDGETS["recorder"]) {
    WIDGETS["recorder"].reload();
  }
}

/**
 * @param {number} newTimePeriod
 *
 * @returns {void}
 */
function handleTimePeriodChange(newTimePeriod) {
  updateAppSettings({ isRecording: false, timePeriod: newTimePeriod });
  logMessage(
    `[handleTimePeriodChange] Update time period to ${newTimePeriod}`,
    "info",
  );
}

/**
 * @returns {void}
 */
function toggleRecorder() {
  const isRecording = getAppSettings()["isRecording"];

  updateAppSettings({ isRecording: !isRecording });
  logMessage(
    `[toggleRecorder] Recording is ${isRecording ? "disabled" : "enabled"}`,
    "info",
  );

  if (WIDGETS["recorder"]) {
    WIDGETS["recorder"].setRecording(!isRecording);
  }

  if (isRecording) {
    return;
  }

  const currentDate = new Date().toISOString().split("T")[0];
  /** @type {string[]} */
  const fileExist = require("Storage").list(currentDate);
  let fileName = "";

  if (fileExist.length === 0 || fileExist[0] === undefined) {
    fileName = `${getAppSettings()["pid"]}_${currentDate}.csv`;
    logMessage(`[toggleRecorder] File created: ${fileName}`, "info");
    require("Storage").open(fileName, "a").write("foo");
  } else {
    fileName = fileExist[0];
    logMessage(`[toggleRecorder] Append to file: ${fileName}`, "info");
  }

  updateAppSettings({ file: fileName });
}

/**
 * @param {string} sensorName
 *
 * @returns {void}
 */
function toggleSensor(sensorName) {
  const enabledSensors = getAppSettings()["enabledSensors"];
  const index = enabledSensors.indexOf(sensorName);

  if (index === -1) {
    updateAppSettings({
      enabledSensors: JSON.parse(
        JSON.stringify(enabledSensors.concat(sensorName)),
      ),
    });
    logMessage(`[toggleSensor] Sensor ${sensorName} enabled`, "info");
  } else {
    updateAppSettings({
      enabledSensors: enabledSensors.filter((sensor) => sensor !== sensorName),
    });
    logMessage(`[toggleSensor] Sensor ${sensorName} disabled`, "info");
  }
}

/**
 * @param {string} fileName
 *
 * @returns {MenuInstance}
 */
function sendCsvFile(fileName) {
  const file = require("Storage").open(fileName, "r");
  const fileLength = file.getLength();

  if (fileLength === 0) {
    logMessage(`[showFileMenu] File ${fileName} not found`, "error");

    return showFilesMenu();
  }

  const macAddress = getAppSettings()["macAddress"];

  NRF.connect(macAddress, {})
    .then(() => {
      logMessage(`[showFileMenu] Connected to ${macAddress}`, "info");

      Bluetooth.println(
        JSON.stringify({
          c: file.read(fileLength),
          n: fileName,
          t: "file",
          timestamp: Date.now(),
        }),
      );

      logMessage(`[showFileMenu] File send to ${macAddress}`, "info");
    })
    .catch(() => {
      logMessage(`[showFileMenu] Fail to connect to ${macAddress}`, "error");

      const now = new Date().getHours();

      if (now >= 0 && now < 1) {
        setTimeout(() => sendCsvFile(fileName), 60000 * 5);
      }
    });

  return showFilesMenu();
}

/**
 * @param {string} fileName
 *
 * @returns {MenuInstance}
 */
function showFileMenu(fileName) {
  /** @type {Menu} */
  const menu = {
    "": { title: fileName.split("_")[1] },
    Delete: () => {
      E.showPrompt("Confirm delete").then((shouldDelete) => {
        if (!shouldDelete) {
          return showFileMenu(fileName);
        }

        updateAppSettings({ isRecording: false });
        require("Storage").erase(fileName);
        logMessage(`[showFileMenu] File ${fileName} deleted`, "info");

        return showFilesMenu();
      });
    },
    Send: () => {
      sendCsvFile(fileName);
    },
    "< Back": () => showFilesMenu(),
  };

  return E.showMenu(menu);
}

/**
 * @returns {MenuInstance}
 */
function showFilesMenu() {
  /** @type {Menu} */
  const menu = {
    "": { title: "Files" },
  };

  const fileList = require("Storage")
    .list(/\d+_\d+-\d+-\d+\.csv/)
    .reverse();

  if (fileList.length === 0) {
    menu["No files found"] = () => {};
  } else {
    for (const fileName of fileList) {
      menu[fileName.split("_")[1]] = () => showFileMenu(fileName);
    }
  }

  menu["< Back"] = () => showMainMenu();

  return E.showMenu(menu);
}

/**
 * @returns {MenuInstance}
 */
function showMainMenu() {
  /** @type {Menu} */
  const menu = {
    "": { title: "Clinikali" },
    "< Back": () => load(),
    Record: {
      onchange: () => toggleRecorder(),
      value: getAppSettings()["isRecording"],
    },
    Sensors: () => showSensorsMenu(),
    Period: {
      format: (/** @type {number} */ value) => `${value} Hz`,
      onchange: (/** @type {number} */ newValue) =>
        handleTimePeriodChange(newValue),
      max: 60,
      min: 1,
      step: 1,
      value: getAppSettings()["timePeriod"],
    },
    "View files": () => showFilesMenu(),
  };

  return E.showMenu(menu);
}

/**
 * @returns {MenuInstance}
 */
function showSensorsMenu() {
  const enabledSensors = getAppSettings()["enabledSensors"];

  /** @type {Menu} */
  const menu = {
    "": { title: "Sensors" },
    Accelerometer: {
      onchange: () => toggleSensor("accel"),
      value: enabledSensors.includes("accel"),
    },
    "Heart rate": {
      onchange: () => toggleSensor("hrm"),
      value: enabledSensors.includes("hrm"),
    },
    Temperature: {
      onchange: () => toggleSensor("baro"),
      value: enabledSensors.includes("baro"),
    },
    "< Back": () => showMainMenu(),
  };

  return E.showMenu(menu);
}

updateAppSettings(getAppSettings());
showMainMenu();
