(() => {
  let storageFile;
  let activeRecorders = [];
  let writeSetup;

  function loadAppSettings() {
    const appSettings = require("Storage").readJSON("clinikali.json", 1) || {};
    appSettings.period = appSettings.period || 10;
    appSettings.localeOffset = appSettings.localeOffset || 1;

    if (
      !appSettings.file ||
      !require("Storage").list(appSettings.file).length
    ) {
      appSettings.recording = false;
    }

    return appSettings;
  }

  function updateAppSettings(appSettings) {
    require("Storage").writeJSON("clinikali.json", appSettings);
    if (WIDGETS.recorder) {
      WIDGETS.recorder.reload();
    }
  }

  function getRecorders() {
    const recorders = {
      accel: () => {
        let x = 0,
          y = 0,
          z = 0;

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
          start: () => {
            Bangle.on("accel", onAccel);
          },
          stop: () => {
            Bangle.removeListener("accel", onAccel);
          },
          draw: (x, y) =>
            g
              .setColor("#00f")
              .drawImage(atob("DAwBAAH4EIHIEIHIEIHIEIEIH4AA"), x, y),
        };
      },

      hrm: () => {
        let heartRate = "";

        function onHRM(heartRateData) {
          heartRate = heartRateData.bpm;
        }

        return {
          name: "HR",
          fields: ["Heartrate"],
          getValues: () => {
            const result = [heartRate];
            heartRate = "";
            return result;
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
      },
    };

    if (Bangle.getPressure) {
      recorders.baro = () => {
        let temperature = "";

        function onPressure(pressureData) {
          temperature = pressureData.temperature;
        }

        return {
          name: "Baro",
          fields: ["Barometer Temperature"],
          getValues: () => {
            const result = [temperature];
            temperature = "";
            return result;
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
      };
    }

    require("Storage")
      .list(/^.*\.clinikali\.js$/)
      .forEach((filename) =>
        eval(require("Storage").read(filename))(recorders),
      );

    return recorders;
  }

  function getActiveRecorders() {
    const appSettings = loadAppSettings();
    const recorders = getRecorders();

    if (!appSettings.record || appSettings.record.length === 0) {
      return [];
    }

    return appSettings.record
      .filter((name) => recorders[name])
      .map((name) => recorders[name]());
  }

  function getCSVHeaders(activeRecorders) {
    return ["Time"].concat(activeRecorders.map((recorder) => recorder.fields));
  }

  function writeLog() {
    WIDGETS.recorder.draw();

    try {
      const appSettings = loadAppSettings();
      const currentDate = new Date();
      const localDate = new Date(
        currentDate.getTime() + appSettings.localeOffset * 60 * 60 * 1000,
      );

      const currentDateStr = localDate.toISOString().slice(0, 10);
      const fields = [
        currentDate.toISOString().replace("T", " ").replace("Z", ""),
      ];

      activeRecorders.forEach((recorder) =>
        fields.push.apply(fields, recorder.getValues()),
      );

      // Check for day change before writing
      if (appSettings.file && !appSettings.file.includes(currentDateStr)) {
        // First write the last data point to the old file
        if (storageFile) {
          storageFile.write(`${fields.join(",")}\n`);
        }

        // Create and setup new file
        const newFilename = `${appSettings.pid}_${currentDateStr}.csv`;

        // Create new file and write headers without triggering a reload
        const newFile = require("Storage").open(newFilename, "w");
        const headers = getCSVHeaders(activeRecorders).join(","); // Flatten the headers array
        newFile.write(`${headers}\n`);
        // newFile.write(`${fields.join(",")}\n`);

        // Update settings without triggering immediate reload
        appSettings.file = newFilename;
        require("Storage").writeJSON("clinikali.json", appSettings);

        // Update storageFile reference
        storageFile = newFile;

        console.log("Day changed, created new file:", newFilename);
      } else {
        // Normal write to current file
        if (storageFile) {
          storageFile.write(`${fields.join(",")}\n`);
        }
      }
    } catch (error) {
      console.log("recorder: error", error);
      const appSettings = loadAppSettings();
      appSettings.recording = false;
      require("Storage").write("clinikali.json", appSettings);
      reload();
    }
  }

  function reload() {
    const appSettings = loadAppSettings();

    if (typeof writeSetup === "number") {
      clearInterval(writeSetup);
    }

    writeSetup = undefined;
    activeRecorders.forEach((recorder) => recorder.stop());
    activeRecorders = [];

    if (appSettings.recording) {
      activeRecorders = getActiveRecorders();
      activeRecorders.forEach((activeRecorder) => activeRecorder.start());

      WIDGETS.recorder.width = 15 + ((activeRecorders.length + 1) >> 1) * 12;

      if (require("Storage").list(appSettings.file).length) {
        storageFile = require("Storage").open(appSettings.file, "a");
      } else {
        storageFile = require("Storage").open(appSettings.file, "w");
        storageFile.write(`${getCSVHeaders(activeRecorders).join(",")}\n`);
      }

      WIDGETS.recorder.draw();
      writeSetup = setInterval(
        writeLog,
        appSettings.period * 1000,
        appSettings.period,
      );
    } else {
      WIDGETS.recorder.width = 0;
      storageFile = undefined;
    }
  }

  WIDGETS.recorder = {
    area: "tl",
    width: 0,
    draw: function () {
      if (!writeSetup) return;

      g.reset().drawImage(
        atob("DRSBAAGAHgDwAwAAA8B/D/hvx38zzh4w8A+AbgMwGYDMDGBjAA=="),
        this.x + 1,
        this.y + 2,
      );

      activeRecorders.forEach((recorder, index) => {
        recorder.draw(
          this.x + 15 + (index >> 1) * 12,
          this.y + (index & 1) * 12,
        );
      });
    },
    getRecorders: getRecorders,
    reload: () => {
      reload();
      Bangle.drawWidgets();
    },
    isRecording: () => !!writeSetup,
    setRecording: (isOn) => {
      const appSettings = loadAppSettings();

      if (isOn && !appSettings.recording) {
        const currentDate = new Date().toISOString().slice(0, 10);
        const filename = `${appSettings.pid}_${currentDate}.csv`;

        if (
          !appSettings.file ||
          !appSettings.file.startsWith(`${appSettings.pid}_${currentDate}`)
        ) {
          appSettings.file = filename;

          if (require("Storage").list(filename).length) {
            require("Storage").open(filename, "r").erase();
          }
        }

        const existingHeaders = require("Storage")
          .open(appSettings.file, "r")
          .readLine();

        if (existingHeaders) {
          if (
            existingHeaders.trim() !==
            getCSVHeaders(getActiveRecorders(appSettings)).join(",")
          ) {
            const storageFile = require("Storage").open(appSettings.file, "a");
            const timestamp = new Date()
              .toISOString()
              .replace("T", " ")
              .replace("Z", "");
            storageFile.write(
              `\n### New sensor configuration at ${timestamp} ###\n`,
            );
            storageFile.write(
              `${getCSVHeaders(getActiveRecorders(appSettings)).join(",")}\n`,
            );
          }
        } else {
          const storageFile = require("Storage").open(appSettings.file, "w");
          storageFile.write(
            `${getCSVHeaders(getActiveRecorders(appSettings)).join(",")}\n`,
          );
        }
      }

      appSettings.recording = isOn;
      updateAppSettings(appSettings);
      WIDGETS.recorder.reload();
      return Promise.resolve(appSettings.recording);
    },
  };

  reload();
})();
