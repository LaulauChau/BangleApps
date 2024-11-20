{
  /**
   * @typedef {Object} AppSettings
   * @property {string} file - Log file name
   * @property {string[]} record - Active sensor names
   * @property {boolean} recording - Recording status
   * @property {number} period - Recording interval in seconds
   */

  /**
   * @typedef {Object} Recorder
   * @property {string} name
   * @property {string[]} fields
   * @property {() => string[]} getValues
   * @property {() => void} start
   * @property {() => void} stop
   * @property {(x: number, y: number) => void} draw
   */

  /**
   * @typedef {Object} RecorderState
   * @property {StorageFile} storageFile
   * @property {Recorder[]} activeRecorders
   * @property {number} writeSetup
   */

  /**
   * @returns {Recorder}
   */
  function createAccelRecorder() {
    let sensorData = { x: "", y: "", z: "" };

    function onAccel(accel) {
      sensorData = { x: accel.x, y: accel.y, z: accel.z };
    }

    return {
      name: "Accel",
      fields: ["AccelX", "AccelY", "AccelZ"],
      getValues: () => {
        const values = [sensorData.x, sensorData.y, sensorData.z];
        sensorData = { x: "", y: "", z: "" };
        return values;
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
  function createHRMRecorder() {
    let heartRate = "";

    function onHRM(data) {
      heartRate = data.bpm;
    }

    return {
      name: "HR",
      fields: ["Heartrate"],
      getValues: () => {
        const value = [heartRate];
        heartRate = "";
        return value;
      },
      start: () => {
        Bangle.on("HRM", onHRM);
        Bangle.setHRMPower(1, "recorder");
      },
      stop: () => {
        Bangle.removeListener("HRM", onHRM);
        Bangle.setHRMPower(0, "recorder");
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
  function createBaroRecorder() {
    let temperature = "";

    function onPressure(data) {
      temperature = data.temperature;
    }

    return {
      name: "Baro",
      fields: ["Barometer Temperature"],
      getValues: () => {
        const value = [temperature];
        temperature = "";
        return value;
      },
      start: () => {
        Bangle.setBarometerPower(1, "recorder");
        Bangle.on("pressure", onPressure);
      },
      stop: () => {
        Bangle.setBarometerPower(0, "recorder");
        Bangle.removeListener("pressure", onPressure);
      },
      draw: (x, y) =>
        g
          .setColor("#0f0")
          .drawImage(atob("DAwBAAH4EIHIEIHIEIHIEIEIH4AA"), x, y),
    };
  }

  /**
   * @returns {Object.<string, () => Recorder>}
   */
  function getRecorders() {
    const recorders = {
      accel: createAccelRecorder,
      hrm: createHRMRecorder,
    };

    if (Bangle.getPressure) {
      recorders.baro = createBaroRecorder;
    }

    require("Storage")
      .list(/^.*\.clinikali\.js$/)
      .forEach((file) => eval(require("Storage").read(file))(recorders));

    return recorders;
  }

  /**
   * @param {AppSettings} settings
   * @returns {Recorder[]}
   */
  function getActiveRecorders(settings) {
    const recorders = getRecorders();
    return (settings.record ?? [])
      .filter((name) => recorders[name])
      .map((name) => recorders[name]());
  }

  /**
   * @param {RecorderState} state
   * @param {AppSettings} settings
   */
  function writeLog(state, settings) {
    try {
      const timestamp = new Date()
        .toISOString()
        .replace("T", " ")
        .replace("Z", "");
      const values = state.activeRecorders.flatMap((r) => r.getValues());
      const line = [timestamp, ...values].join(",") + "\n";

      if (state.storageFile) {
        state.storageFile.write(line);
      }
    } catch (error) {
      console.log("recorder: error", error);
      settings.recording = false;
      require("Storage").write("clinikali.json", settings);
      reload();
    }
  }

  /**
   * @param {Date} date
   * @param {number} number
   * @returns {string}
   */
  function generateFilename(date, number) {
    const dateStr = date.toISOString().substr(0, 10).replace(/-/g, "");
    return `clinikali.log${dateStr}${number.toString(36)}.csv`;
  }

  /**
   * @param {RecorderState} state
   * @returns {Object} Widget configuration
   */
  function createRecorderWidget(state) {
    return {
      area: "tl",
      width: 0,
      draw: function () {
        if (!state.writeSetup) return;

        g.reset().drawImage(
          atob("DRSBAAGAHgDwAwAAA8B/D/hvx38zzh4w8A+AbgMwGYDMDGBjAA=="),
          this.x + 1,
          this.y + 2,
        );

        state.activeRecorders.forEach((recorder, i) => {
          recorder.draw(this.x + 15 + (i >> 1) * 12, this.y + (i & 1) * 12);
        });
      },
      getRecorders,
      reload: () => {
        reload();
        Bangle.drawWidgets();
      },
      isRecording: () => !!state.writeSetup,
      setRecording: (isOn, options = {}) => {
        const settings = loadAppSettings();

        if (isOn && !settings.recording) {
          settings.file = handleRecordingStart(settings, options);
        }

        settings.recording = isOn;
        updateAppSettings(settings);
        WIDGETS.recorder.reload();
        return Promise.resolve(settings.recording);
      },
    };
  }

  /**
   * @param {AppSettings} settings
   * @param {Object} options
   * @returns {string} Filename
   */
  function handleRecordingStart(settings, options) {
    const date = new Date();
    let trackNumber = 10;
    let filename = generateFilename(date, trackNumber);

    const existingHeaders = require("Storage")
      .open(settings.file, "r")
      .readLine();

    if (existingHeaders) {
      const newHeaders = getCSVHeaders(getActiveRecorders(settings)).join(",");

      if (existingHeaders.trim() !== newHeaders) {
        options.force = "new";
      }

      if (!options.force) {
        return handleExistingFile(settings, options);
      }

      if (options.force === "append") {
        return settings.file;
      } else if (options.force === "overwrite") {
        require("Storage").open(settings.file, "r").erase();
        return settings.file;
      } else if (options.force === "new") {
        while (require("Storage").list(filename).length) {
          trackNumber++;
          filename = generateFilename(date, trackNumber);
        }
        return filename;
      }
    }

    return filename;
  }

  /**
   * @param {AppSettings} settings
   * @returns {Promise<boolean|string>}
   */
  function handleExistingFile(settings) {
    return E.showPrompt(
      `Overwrite\nLog ${settings.file.match(/^clinikali\.log(.*)\.csv$/)[1]}?`,
      {
        title: "Recorder",
        buttons: {
          Yes: "overwrite",
          No: "cancel",
          New: "new",
          Append: "append",
        },
      },
    ).then((selection) => {
      if (selection === "cancel") return false;
      return WIDGETS.recorder.setRecording(1, { force: selection });
    });
  }

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

    const storedSettings =
      require("Storage").readJSON("clinikali.json", 1) ?? {};
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
   * @param {Recorder[]} recorders
   * @returns {string[]}
   */
  function getCSVHeaders(recorders) {
    return ["Time"].concat(recorders.map((recorder) => recorder.fields));
  }

  /**
   * @param {RecorderState} state
   * @param {AppSettings} settings
   */
  function reload(state, settings) {
    if (state.writeSetup) {
      clearInterval(state.writeSetup);
    }

    state.writeSetup = undefined;
    state.activeRecorders.forEach((recorder) => recorder.stop());
    state.activeRecorders = [];

    if (settings.recording) {
      state.activeRecorders = getActiveRecorders(settings);
      state.activeRecorders.forEach((recorder) => recorder.start());

      const storage = require("Storage");
      state.storageFile = storage.list(settings.file).length
        ? storage.open(settings.file, "a")
        : storage
            .open(settings.file, "w")
            .write(getCSVHeaders(state.activeRecorders).join(",") + "\n");

      state.writeSetup = setInterval(
        () => writeLog(state, settings),
        settings.period * 1000,
      );
    }
  }

  // Initialize
  const state = {
    storageFile: null,
    activeRecorders: [],
    writeSetup: undefined,
  };

  WIDGETS.recorder = createRecorderWidget(state);
  reload(state, loadAppSettings());
}
