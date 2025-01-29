() => {
  /**
   * @typedef {Object} Recorder
   * @property {string} name
   * @property {string[]} fields
   * @property {() => Array<string|number>} getValues
   * @property {() => void} start
   * @property {() => void} stop
   * @property {(x: number, y: number) => void} draw
   */

  /**
   * @param {string} message
   * @param {"info" | "warn" | "error" } severity
   *
   * @returns {void}
   */
  function logAction(message, severity = "info") {
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
    logAction("Settings updated");
  }

  /**
   * @returns {Recorder}
   */
  function getAccelerometerRecorder() {
    let x = 0,
      y = 0,
      z = 0;

    /**
     * @param {{ x: number, y: number, z: number }} acceleration
     *
     * @returns {void}
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
      draw: (x, y) =>
        g
          .setColor("#00f")
          .drawImage(atob("DAwBAAH4EIHIEIHIEIHIEIEIH4AA"), x, y),
    };
  }

  /**
   * @returns {Recorder}
   */
  function getHRMRecorder() {
    let bpm = 0;

    /**
     * @param {{ bpm: number }} heartRateData
     */
    function onHRM(heartRateData) {
      bpm = heartRateData.bpm;
    }

    return {
      name: "HR",
      fields: ["Heartrate"],
      getValues: () => {
        const result = [bpm];

        bpm = 0;

        return result;
      },
      start: () => {
        Bangle.setHRMPower(1, "clinikali");
        Bangle.on("HRM", onHRM);
      },
      stop: () => {
        Bangle.removeListener("HRM", onHRM);
        Bangle.setHRMPower(0, "clinikali");
      },
      draw: (x, y) =>
        g
          .setColor(Bangle.isHRMOn() ? "#f00" : "#f88")
          .drawImage(atob("DAwBAAAAMMeef+f+f+P8H4DwBgAA"), x, y),
    };
  }

  /**
   * @returns {Recorder}
   */
  function getBarometerRecorder() {
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
        Bangle.setBarometerPower(1, "clinikali");
        Bangle.on("pressure", onPressure);
      },
      stop: () => {
        Bangle.removeListener("pressure", onPressure);
        Bangle.setBarometerPower(0, "clinikali");
      },
      draw: (x, y) =>
        g
          .setColor("#0f0")
          .drawImage(atob("DAwBAAH4EIHIEIHIEIHIEIEIH4AA"), x, y),
    };
  }

  /**
   * @returns {{ [key: string]: () => Recorder }}
   */
  function getRecorders() {
    const recorders = {
      accel: getAccelerometerRecorder,
      hrm: getHRMRecorder,
    };

    if (Bangle.getPressure) {
      recorders.baro = getBarometerRecorder;
    }

    require("Storage")
      .list(/^.*\.clinikali\.js$/)
      .forEach((fileName) =>
        eval(require("Storage").read(fileName))(recorders),
      );

    return recorders;
  }

  /**
   * @returns {Recorder[]}
   */
  function getActiveRecorders() {
    const appSettings = getAppSettings();
    const recorders = getRecorders();

    if (!appSettings.record || appSettings.record.length === 0) {
      return [];
    }

    return appSettings.record
      .filter((name) => recorders[name])
      .map((name) => recorders[name]());
  }

  /**
   * @param {Recorder[]} activeRecorders
   *
   * @returns {string[]}
   */
  function getCSVHeaders(activeRecorders) {
    return ["Time"].concat(
      activeRecorders.map((recorder) => recorder.fields).flat(),
    );
  }

  /**
   * @param {string} fileName
   * @param {Recorder[]} activeRecorders
   */
  function initializeNewFile(fileName, activeRecorders) {
    const file = require("Storage").open(fileName, "w");
    const headers = getCSVHeaders(activeRecorders);

    file.write(headers.join(",") + "\n");

    return file;
  }

  class RecorderWidget {
    constructor() {
      this.activeRecorders = [];
      this.storageFile = null;
      this.writeSetup = undefined;
    }

    writeData() {
      WIDGETS.clinikali.draw();

      try {
        const appSettings = getAppSettings();
        const currentDate = new Date();
        const localDate = new Date(
          currentDate.getTime() + appSettings.localeOffset * 60 * 60 * 1000,
        );
        const currentDateStr = localDate.toISOString().slice(0, 10);

        const fields = [
          currentDate.toISOString().replace("T", " ").replace("Z", ""),
        ];
        this.activeRecorders.forEach((recorder) =>
          fields.push.apply(fields, recorder.getValues()),
        );

        if (appSettings.file && !appSettings.file.includes(currentDateStr)) {
          if (this.storageFile) {
            this.storageFile.write(`${fields.join(",")}\n`);
          }

          const newFilename = `${appSettings.pid}_${currentDateStr}.csv`;

          this.storageFile = initializeNewFile(
            newFilename,
            this.activeRecorders,
          );

          setAppSettings({ file: newFilename });
          logAction(`New file created: ${newFilename}`);
        } else {
          this.storageFile.write(`${fields.join(",")}\n`);
        }
      } catch (error) {
        logAction(`Error: ${error}`, "error");
        setAppSettings({ recording: false });
        this.reload();
      }
    }

    reload() {
      const appSettings = getAppSettings();

      if (typeof this.writeSetup === "number") {
        clearInterval(this.writeSetup);
      }

      this.writeSetup = undefined;
      this.activeRecorders.forEach((recorder) => recorder.stop());

      if (!appSettings.recording) {
        WIDGETS.clinikali.width = 0;
        this.storageFile = null;
        return;
      }

      this.activeRecorders = getActiveRecorders();
      this.activeRecorders.forEach((recorder) => recorder.start());
      WIDGETS.clinikali.width =
        15 + ((this.activeRecorders.length + 1) >> 1) * 12;

      if (require("Storage").list(appSettings.file).length) {
        this.storageFile = require("Storage").open(appSettings.file, "a");
      } else {
        this.storageFile = initializeNewFile(
          appSettings.file,
          this.activeRecorders,
        );
      }

      WIDGETS.clinikali.draw();
      this.writeSetup = setInterval(
        () => this.writeData(),
        appSettings.period * 1000,
        appSettings.period,
      );
    }

    /**
     * @param {boolean} isOn
     *
     * @returns {Promise<boolean>}
     */
    setRecording(isOn) {
      const appSettings = getAppSettings();

      if (isOn && !appSettings.recording) {
        const currentDate = new Date().toISOString().slice(0, 10);
        const fileName = `${appSettings.pid}_${currentDate}.csv`;

        if (
          !appSettings.file ||
          !appSettings.file.includes(fileName.replace(".csv", ""))
        ) {
          if (require("Storage").list(fileName).length) {
            require("Storage").open(fileName, "r").erase();
          }

          setAppSettings({ file: fileName });
        }

        const existingHeaders = require("Storage")
          .open(appSettings.file, "r")
          .readLine();
        const newHeaders = getCSVHeaders(this.activeRecorders).join(",");

        if (existingHeaders && existingHeaders.trim() !== newHeaders) {
          const storageFile = require("Storage").open(appSettings.file, "a");
          const timestamp = new Date()
            .toISOString()
            .replace("T", " ")
            .replace("Z", "");

          storageFile.write(
            `\n### New sensor configuration at ${timestamp} ###\n`,
          );
          storageFile.write(`${newHeaders}\n`);

          logAction(`New headers added to ${appSettings.file}`);
        } else {
          this.storageFile = initializeNewFile(
            appSettings.file,
            getActiveRecorders(),
          );
        }
      }

      setAppSettings({ recording: isOn });

      WIDGETS.clinikali.reload();

      return Promise.resolve(true);
    }
  }

  const recorderWidget = new RecorderWidget();

  WIDGETS.clinikali = {
    area: "tl",
    width: 0,
    draw: function () {
      if (!recorderWidget.writeSetup) return;

      g.reset().drawImage(
        atob("DRSBAAGAHgDwAwAAA8B/D/hvx38zzh4w8A+AbgMwGYDMDGBjAA=="),
        this.x + 1,
        this.y + 2,
      );

      recorderWidget.activeRecorders.forEach((recorder, index) => {
        recorder.draw(
          this.x + 15 + (index >> 1) * 12,
          this.y + (index & 1) * 12,
        );
      });
    },
    getRecorders,
    reload: () => {
      recorderWidget.reload();
      Bangle.drawWidgets();
    },
    isRecording: () => !!recorderWidget.writeSetup,
    setRecording: (isOn) => recorderWidget.setRecording(isOn),
  };

  recorderWidget.reload();
};
