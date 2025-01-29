/**
 * @param {string} message
 * @param {"info" | "warn" | "error"} severity
 *
 * @returns {void}
 */
function logAction(message, severity) {
  const logFile = require("Storage").open("clinikali.log.txt", "a");
  const logEntry = `${new Date().toISOString()} [${severity.toUpperCase()}] ${message}\n`;

  return logFile.write(logEntry);
}

/**
 * @returns {{ [key: string]: unknown }}
 */
function getAppSettings() {
  /** @type {{ [key: string]: unknown }} */
  const appSettingsFile =
    require("Storage").readJSON("clinikali.json", 1) || {};

  return Object.assign(
    {},
    {
      period: 1,
      pid: "05",
      record: ["accel", "baro", "hrm"],
      recording: false,
    },
    appSettingsFile,
  );
}

/**
 * @param {{ [key: string]: unknown }} newSettings
 *
 * @returns {void}
 */
function setAppSettings(newSettings) {
  const appSettings = getAppSettings();
  const updatedSettings = Object.assign({}, appSettings, newSettings);

  require("Storage").writeJSON("clinikali.json", updatedSettings);
  logAction("Settings updated", "info");
}

/**
 * @param {string} sensorName
 *
 * @returns {void}
 */
function toggleSensorRecording(sensorName) {
  const appSettings = getAppSettings();
  /** @type {string[]} */
  const record = appSettings.record;
  const sensorIndex = record.indexOf(sensorName);

  if (sensorIndex === -1) {
    record.push(sensorName);
    logAction(`Sensor ${sensorName} enabled`, "info");
  } else {
    record.splice(sensorIndex, 1);
    logAction(`Sensor ${sensorName} disabled`, "info");
  }

  setAppSettings({ record });
}

/**
 * @returns {void}
 */
function showSensorMenu() {
  const appSettings = getAppSettings();
  const record = appSettings.record;

  const menu = {
    "": { title: /*LANG*/ "Sensors" },
    /*LANG*/ Accelerometer: {
      onchange: () => toggleSensorRecording("accel"),
      value: record.includes("accel"),
    },
    /*LANG*/ "Heart Rate": {
      onchange: () => toggleSensorRecording("hrm"),
      value: record.includes("hrm"),
    },
  };

  if (Bangle.getPressure) {
    menu[/*LANG*/ "Temperature"] = {
      onchange: () => toggleSensorRecording("baro"),
      value: record.includes("baro"),
    };
  }

  menu[/*LANG*/ "< Back"] = () => showMainMenu();

  return E.showMenu(menu);
}

/**
 * @returns {void}
 */
function showFilesMenu() {
  const menu = {
    "": { title: /*LANG*/ "Files" },
  };

  /** @type {string[]} */
  const fileList = require("Storage")
    .list(/\d+_\d+-\d+-\d+\.csv/, { sf: true })
    .reverse();

  if (fileList.length === 0) {
    menu[/*LANG*/ "No files found"] = () => {};
  } else {
    for (const file of fileList) {
      menu[file.match(/\d+-\d+-\d+/)[0]] = () => showFileMenu(file);
    }
  }

  menu[/*LANG*/ "< Back"] = () => showMainMenu();

  return E.showMenu(menu);
}

/**
 * @param {string} fileName
 *
 * @returns {void}
 */
function deleteFile(fileName) {
  return E.showPrompt(/*LANG*/ "Delete file?").then((shouldDelete) => {
    if (!shouldDelete) {
      return showFileMenu(fileName);
    }

    require("Storage").open(fileName, "r").erase();
    logAction(`File ${fileName} deleted`, "warn");

    return showFilesMenu();
  });
}

/**
 * @param {string} fileName
 *
 * @returns {void}
 */
function sendCsvFile(fileName) {
  const fileContent = require("Storage").read(fileName);

  if (!fileContent) {
    return logAction(`File ${fileName} not found`, "error");
  }

  const { macAddress } = getAppSettings();

  NRF.connect(macAddress)
    .then(() => {
      logAction(`Connected to ${macAddress}`, "info");

      Bluetooth.println(
        JSON.stringify({
          c: fileContent,
          n: fileName,
          t: "file",
          timestamp: Date.now(),
        }),
      );

      logAction(`Sent file ${fileName}`, "info");

      E.showMessage("File sent");

      setTimeout(() => showFilesMenu(), 1000);
    })
    .catch(() => {
      logAction(`Failed to connect to ${macAddress}`, "error");

      const now = new Date().getHours();

      if (now >= 0 && now < 1) {
        setTimeout(() => sendCsvFile(fileName), 60000 * 5);
      } else {
        E.showMessage("Failed to connect");

        setTimeout(() => showFilesMenu(), 1000);
      }
    });
}

/**
 * @param {string} fileName
 *
 * @returns {void}
 */
function showFileMenu(fileName) {
  const menu = {
    "": { title: fileName },
    Delete: () => deleteFile(fileName),
    Send: () => sendCsvFile(fileName),
  };

  menu[/*LANG*/ "< Back"] = () => showFilesMenu();

  return E.showMenu(menu);
}

/**
 * @returns {void}
 */
function showMainMenu() {
  const menu = {
    "": { title: "Clinikali" },
    /*LANG*/ "< Back": () => load(),
    /*LANG*/ Record: {
      onchange: (shouldRecord) => {
        WIDGETS.clinikali.setRecording(shouldRecord).then(() => {
          logAction(
            `Recording ${shouldRecord ? "enabled" : "disabled"}`,
            "info",
          );
          showMainMenu();
        });
      },
      value: !!getAppSettings().recording,
    },
    /*LANG*/ "View files": () => showFilesMenu(),
    /*LANG*/ Sensors: () => showSensorMenu(),
    /*LANG*/ "Time period": {
      format: (value) => `${value} Hz`,
      max: 60,
      min: 1,
      onchange: (period) => {
        logAction(`Period set to ${period} Hz`);
        setAppSettings({ period, recording: false });
      },
      step: 1,
      value: getAppSettings().period,
    },
  };

  return E.showMenu(menu);
}

showMainMenu();
