(() => {
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
   * @typedef {Object} Recorder
   * @property {string} name
   * @property {string[]} fields
   * @property {() => number[]} getValues
   * @property {() => void} start
   * @property {() => void} stop
   */

  /** @type {Recorder[]} */
  let activeRecorders = [];
  /** @type {StorageFile | undefined} */
  let storageFile;
  /** @type {IntervalId | undefined} */
  let writeSetup = undefined;

  /**
   * @param {string} message
   * @param {"info" | "warn" | "error"} severity
   *
   * @returns {void}
   */
  function logMessage(message, severity) {
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
  function getAppSettings() {
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
   * @param {boolean} skipReload - Skip calling reload() to prevent infinite loops
   *
   * @returns {void}
   */
  function updateAppSettings(settings, skipReload) {
    if (skipReload === undefined) skipReload = false;

    const currentSettings = getAppSettings();

    require("Storage").writeJSON(
      "clinikali.json",
      Object.assign(currentSettings, settings),
    );
    logMessage(
      `[updateAppSettings] Settings updated: ${JSON.stringify(settings)}`,
      "info",
    );

    if (!skipReload) {
      reload();
    }
  }

  /**
   * @returns {Recorder[]}
   */
  function getRecorders() {
    const enabledRecorders = getAppSettings()["enabledSensors"];

    if (activeRecorders.length > 0) {
      activeRecorders.every((recorder) =>
        enabledRecorders.includes(recorder.name.toLowerCase()),
      );

      return activeRecorders;
    }

    /** @type {{ [key: string]: () => Recorder }} */
    const recorders = {};

    if (enabledRecorders.includes("accel")) {
      recorders["accel"] = () => {
        let x = 0,
          y = 0,
          z = 0;

        /**
         * @param {{ x: number, y: number, z: number }} acceleration
         */
        function onAccel(acceleration) {
          x = acceleration.x;
          y = acceleration.y;
          z = acceleration.z;
        }

        return {
          name: "Accel",
          fields: ["AccelX", "AccelY", "AccelZ"],
          getValues: () => {
            const result = [x, y, z];

            x = 0;
            y = 0;
            z = 0;

            return result;
          },
          start: () => Bangle.on("accel", onAccel),
          stop: () => Bangle.removeListener("accel", onAccel),
        };
      };
    }

    if (enabledRecorders.includes("hrm")) {
      recorders["hrm"] = () => {
        let bpm = 0;

        /**
         * @param {{ bpm: number }} heartRateData
         */
        function onHRM(heartRateData) {
          bpm = heartRateData.bpm;
        }

        return {
          name: "HRM",
          fields: ["Heartrate"],
          getValues: () => {
            const result = [bpm];

            bpm = 0;

            return result;
          },
          start: () => {
            Bangle.on("HRM", onHRM);
            Bangle.setHRMPower(true, "clinikali");
          },
          stop: () => {
            Bangle.removeListener("HRM", onHRM);
            Bangle.setHRMPower(false, "clinikali");
          },
        };
      };
    }

    if (enabledRecorders.includes("baro")) {
      recorders["baro"] = () => {
        let temperature = 0;

        /**
         * @param {{ temperature: number }} pressureData
         */
        function onPressure(pressureData) {
          temperature = pressureData.temperature;
        }

        return {
          name: "Baro",
          fields: ["Temperature"],
          getValues: () => {
            const result = [temperature];

            temperature = 0;

            return result;
          },
          start: () => {
            Bangle.setBarometerPower(true, "clinikali");
            Bangle.on("pressure", onPressure);
          },
          stop: () => {
            Bangle.setBarometerPower(false, "clinikali");
            Bangle.removeListener("pressure", onPressure);
          },
        };
      };
    }

    activeRecorders = Object.values(recorders).map((createRecorder) =>
      createRecorder(),
    );

    return activeRecorders;
  }

  /**
   * @returns {string}
   */
  function getCSVHeaders() {
    const recorders =
      activeRecorders.length > 0 ? activeRecorders : getRecorders();

    return ["Time"]
      .concat(recorders.map((recorder) => recorder.fields.join(",")))
      .join(",");
  }

  /**
   * @returns {void}
   */
  function createNewFile() {
    const newFilename = `${getAppSettings().pid}_${
      new Date().toISOString().split("T")[0]
    }.csv`;
    const csvHeaders = getCSVHeaders();

    const newFile = require("Storage").open(newFilename, "a");
    storageFile = newFile;
    logMessage(`[createNewFile] Created new file: ${newFilename}`, "info");
    updateAppSettings({ file: newFilename }, true); // Skip reload to prevent infinite loop

    newFile.write(`${csvHeaders}\n`);
  }

  /**
   * @param {string} oldFileName
   *
   * @returns {Promise<void>}
   */
  // function sendFileOnDayChange(oldFileName) {
  //   return new Promise((resolve, reject) => {
  //     const file = require("Storage").open(oldFileName, "r");
  //     const fileLength = file.getLength();

  //     if (fileLength === 0) {
  //       logMessage(
  //         `[sendFileOnDayChange] File ${oldFileName} not found`,
  //         "error",
  //       );
  //       reject(new Error("File not found"));
  //       return;
  //     }

  //     const macAddress = getAppSettings()["macAddress"];

  //     NRF.connect(macAddress, {})
  //       .then(() => {
  //         logMessage(
  //           `[sendFileOnDayChange] Connected to ${macAddress}`,
  //           "info",
  //         );

  //         Bluetooth.println(
  //           JSON.stringify({
  //             c: file.read(fileLength),
  //             n: oldFileName,
  //             t: "file",
  //             timestamp: Date.now(),
  //           }),
  //         );

  //         logMessage(
  //           `[sendFileOnDayChange] File ${oldFileName} sent to ${macAddress}`,
  //           "info",
  //         );
  //         resolve();
  //       })
  //       .catch((/** @type {unknown} */ error) => {
  //         logMessage(
  //           `[sendFileOnDayChange] Failed to connect to ${macAddress}`,
  //           "error",
  //         );

  //         // Only retry during midnight hour (0-1)
  //         const now = new Date().getHours();
  //         if (now >= 0 && now < 1) {
  //           setTimeout(() => sendFileOnDayChange(oldFileName), 60000 * 5); // retry in 5 minutes
  //         }
  //         reject(error);
  //       });
  //   });
  // }

  /**
   * @param {string[]} data
   *
   * @returns {void}
   */
  // function handleDayChange(data) {
  //   const oldFileName = getAppSettings()["file"];

  //   if (storageFile) {
  //     storageFile.write(`${data.join(",")}\n`);
  //   }

  //   // Try to send the file before creating a new one
  //   sendFileOnDayChange(oldFileName)
  //     .catch((/** @type {unknown} */ error) => {
  //       logMessage(`[handleDayChange] Error sending file: ${error}`, "error");
  //     })
  //     .finally(() => {
  //       // Create new file regardless of whether send succeeded
  //       createNewFile();
  //     });
  // }

  /**
   * @returns {void}
   */
  function writeData() {
    // const appSettings = getAppSettings();
    const utcTime = new Date();
    // const localTime = new Date(
    //   utcTime.getTime() + appSettings.localeOffset * 60 * 60 * 1000,
    // );

    // const currentDate = localTime.toISOString().split("T")[0];
    const fields = [utcTime.toISOString().replace("T", " ").replace("Z", "")];

    const recorders =
      activeRecorders.length > 0 ? activeRecorders : getRecorders();
    recorders.forEach((recorder) =>
      fields.push.apply(fields, recorder.getValues()),
    );

    try {
      // if (appSettings.file && !appSettings.file.includes(currentDate)) {
      //   handleDayChange(fields);
      // } else if (storageFile) {
      //   storageFile.write(`${fields.join(",")}\n`);
      // }

      if (storageFile) {
        storageFile.write(`${fields.join(",")}\n`);
      }
    } catch (error) {
      updateAppSettings({ isRecording: false });
      logMessage(`[writeData] Error: ${error}`, "error");
      reload();
    }
  }

  /**
   * @returns {void}
   */
  function reload() {
    const appSettings = getAppSettings();

    if (writeSetup) {
      clearInterval(writeSetup);
      writeSetup = undefined;
    }

    const recorders =
      activeRecorders.length > 0 ? activeRecorders : getRecorders();
    recorders.forEach((recorder) => recorder.stop());

    if (!appSettings.isRecording) {
      storageFile = undefined;

      return;
    }

    recorders.forEach((recorder) => recorder.start());

    if (appSettings.file) {
      const fileExist =
        require("Storage").list(new RegExp(appSettings.file), { sf: true })
          .length > 0;

      if (!fileExist) {
        createNewFile();
      } else {
        storageFile = require("Storage").open(appSettings.file, "a");
      }
    }

    writeSetup = setInterval(writeData, appSettings.timePeriod * 1000);
  }

  WIDGETS["clinikali"] = {
    area: "tl",
    width: 0,
    draw: () => {},
    // @ts-expect-error
    getRecorders,
    reload: () => {
      reload();
      Bangle.drawWidgets();
    },
    isRecording: () => !!writeSetup,
    setRecording: (/** @type {boolean} */ isOn) => {
      const appSettings = getAppSettings();

      if (isOn && !appSettings.isRecording) {
        handleNewRecording(appSettings);
      }

      updateAppSettings({ isRecording: isOn });

      if (WIDGETS["clinikali"]) {
        WIDGETS["clinikali"].reload();
      }

      return Promise.resolve(appSettings.isRecording);
    },
  };

  /**
   * @param {AppSettings} appSettings
   */
  function handleNewRecording(appSettings) {
    const currentDate = new Date().toISOString().split("T")[0];
    const filename = `${appSettings.pid}_${currentDate}.csv`;

    if (!appSettings.file?.startsWith(`${appSettings.pid}_${currentDate}`)) {
      updateAppSettings({ file: filename }, true); // Skip reload to prevent infinite loop

      if (
        require("Storage").list(new RegExp(filename), { sf: true }).length > 0
      ) {
        require("Storage").open(filename, "r").erase();
      }
    }

    const file = require("Storage").open(appSettings.file, "r");
    const existingHeaders = file.readLine();
    const newHeaders = getCSVHeaders();

    if (!existingHeaders) {
      require("Storage").open(appSettings.file, "w").write(`${newHeaders}\n`);

      return;
    }

    if (existingHeaders.trim() !== newHeaders) {
      const storageFile = require("Storage").open(appSettings.file, "a");
      const timestamp = new Date()
        .toISOString()
        .replace("T", " ")
        .replace("Z", "");

      storageFile.write(`\n### New sensor configuration at ${timestamp} ###\n`);
      storageFile.write(`${newHeaders}\n`);
    }
  }

  reload();
})();
