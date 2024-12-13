/* ==== CONSTANTS */
const DEFAULT_SETTINGS = {
  period: 1,
  pid: "05", // Change this to your own PID
  record: ["accel", "hrm", "baro"],
};

const SENSOR_TYPES = {
  ACCELEROMETER: "accel",
  HEART_RATE: "hrm",
  TEMPERATURE: "baro",
};

class LogService {
  static LOG_FILE = "clinikali.log";

  /**
   * @param {string} message
   *
   * @returns {void}
   */
  static log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    const file = StorageService.open(LogService.LOG_FILE, "a");
    file.write(logMessage);
  }
}

class StorageService {
  /**
   * @param {string} filename
   *
   * @returns {object|undefined}
   */
  static readJSON(filename) {
    return require("Storage").readJSON(filename, 1);
  }

  /**
   * @param {string} filename
   * @param {object} data
   *
   * @returns {boolean}
   */
  static writeJSON(filename, data) {
    return require("Storage").write(filename, JSON.stringify(data));
  }

  /**
   * @param {string} pattern
   *
   * @returns {Array<string>}
   */
  static listFiles(pattern) {
    return require("Storage").list(pattern, { sf: true });
  }

  /**
   * @param {string} filename
   *
   * @returns {void}
   */
  static erase(filename) {
    require("Storage").erase(filename);
  }

  /**
   * @param {string} filename
   * @param {"r"|"w"|"a"} mode
   *
   * @returns {object}
   */
  static open(filename, mode) {
    return require("Storage").open(filename, mode);
  }
}

class SettingsManager {
  constructor() {
    this.settings = null;
    this.SETTINGS_FILE = "clinikali.json";
  }

  /**
   * @returns {object}
   */
  load() {
    this.settings =
      StorageService.readJSON(this.SETTINGS_FILE) ?? DEFAULT_SETTINGS;

    if (!this.settings.file) {
      this.settings.file = FileManager.generateFileName(this.settings.pid);
      this.save();
    }

    return this.settings;
  }

  /**
   * @returns {void}
   */
  save() {
    StorageService.writeJSON(this.SETTINGS_FILE, this.settings);

    if (WIDGETS.recorder) {
      WIDGETS.recorder.reload();
    }
  }

  /**
   * @param {string} key
   * @param {any} value
   *
   * @returns {void}
   */
  update(key, value) {
    const oldValue = this.settings[key];
    this.settings[key] = value;

    this.save();
    LogService.log(
      `Setting updated: ${key} from ${oldValue ?? "undefined"} to ${
        value ?? "undefined"
      }`,
    );
  }

  /**
   * @param {boolean} useExistingTimestamp
   *
   * @returns {string}
   */
  generateNewFile(useExistingTimestamp = false) {
    const currentFile = this.settings.file;
    const parsedFile = FileManager.parseFileName(currentFile);

    if (useExistingTimestamp && parsedFile) {
      this.settings.file = FileManager.findLatestFileWithTimestamp(
        this.settings.pid,
        parsedFile.timestamp,
      );
    } else {
      this.settings.file = FileManager.generateFileName(this.settings.pid);
    }

    this.save();
    LogService.log(
      `New file generated: ${this.settings.file} (old: ${currentFile})`,
    );

    return this.settings.file;
  }
}

class FileManager {
  /**
   * @param {string} userId
   * @param {number} [timestamp]
   *
   * @returns {string}
   */
  static generateFileName(userId, timestamp = Date.now()) {
    const formattedTimestamp = timestamp.toString().padStart(13, "0");

    return `${userId}_${formattedTimestamp}.csv`;
  }

  /**
   * @param {string} userId
   * @param {number} timestamp
   *
   * @returns {string}
   */
  static findLatestFileWithTimestamp(userId, timestamp) {
    const basePattern = `${userId}_${timestamp}`;
    const files = StorageService.listFiles(
      new RegExp(`^${basePattern}.*\.csv$`),
    );

    if (files.length === 0) {
      return `${basePattern}.csv`;
    }

    let maxSuffix = -1;
    for (const file of files) {
      const match = file.match(
        new RegExp(`^${basePattern}(?:_(\\d+))?\\.csv$`),
      );

      if (match) {
        const suffix = match[1] ? parseInt(match[1], 10) : 0;

        maxSuffix = Math.max(maxSuffix, suffix);
      }
    }

    return maxSuffix === -1
      ? `${basePattern}.csv`
      : `${basePattern}_${maxSuffix}.csv`;
  }

  /**
   * @param {string} filename
   *
   * @returns {object|null}
   */
  static parseFileName(filename) {
    const match = filename.match(/^([A-Z0-9]+)_(\d+)(?:_(\d+))?\.csv$/);

    if (!match) {
      return null;
    }

    return {
      pid: match[1],
      timestamp: parseInt(match[2], 10),
      suffix: match[3] ? parseInt(match[3], 10) : 0,
    };
  }
}

class UIManager {
  /**
   * @param {SettingsManager} settingsManager
   */
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
  }

  /**
   * @param {string} message
   * @param {number} [duration]
   *
   * @returns {Promise<void>}
   */
  showMessage(message, duration = 2000) {
    E.showMessage(message);

    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  /**
   * @param {string} message
   *
   * @returns {Promise<boolean>}
   */
  showPrompt(message) {
    return E.showPrompt(message);
  }

  /**
   * @param {object} options
   *
   * @returns {object}
   */
  createMenu(options) {
    return E.showMenu(options);
  }
}

class MenuManager {
  /**
   * @param {SettingsManager} settingsManager
   * @param {UIManager} uiManager
   */
  constructor(settingsManager, uiManager) {
    this.settingsManager = settingsManager;
    this.uiManager = uiManager;
  }

  /**
   * @returns {void}
   */
  showMainMenu() {
    const settings = this.settingsManager.settings;
    const mainMenuOptions = {
      "": { title: "Clinikali" },
      "< Back": () => load(),
      Record: {
        onchange: this.handleRecordingChange.bind(this),
        value: !!settings.recording,
      },
      PID: { value: settings.pid },
      "View Files": () => this.showFilesMenu(),
      Sensors: () => this.showSensorMenu(),
      "Time Period": {
        format: (value) => `${value} Hz`,
        onchange: this.handlePeriodChange.bind(this),
        max: 120,
        min: 1,
        step: 1,
        value: settings.period ?? 1,
      },
    };

    this.uiManager.createMenu(mainMenuOptions);
  }

  /**
   * @returns {void}
   */
  showFilesMenu() {
    const settings = this.settingsManager.settings;
    const fileMenuOptions = {
      "": { title: "Files" },
    };

    const userFiles = StorageService.listFiles(
      new RegExp(`^${settings.pid}_.*\.csv$`),
    ).reverse();

    if (userFiles.length === 0) {
      fileMenuOptions["No files found"] = () => {};
    } else {
      for (const filename of userFiles) {
        const parsed = FileManager.parseFileName(filename);

        if (parsed) {
          const displayDate = new Date(parsed.timestamp)
            .toISOString()
            .replace("T", " ")
            .substring(0, 19);

          fileMenuOptions[displayDate] = () => this.viewFile(filename);
        }
      }
    }

    fileMenuOptions["< Back"] = () => this.showMainMenu();
    this.uiManager.createMenu(fileMenuOptions);
  }

  /**
   * @param {string} filename
   *
   * @returns {void}
   */
  viewFile(filename) {
    const fileMenuOptions = {
      "": { title: `File ${FileManager.parseFileName(filename).timestamp}` },
      "< Back": () => this.showFilesMenu(),
      Delete: () => {
        this.uiManager.showPrompt("Delete file?").then((confirmed) => {
          if (confirmed) {
            StorageService.erase(filename);
            LogService.log(`File ${filename} deleted`);
            this.showFilesMenu();
          } else {
            this.viewFile(filename);
          }
        });
      },
    };

    this.uiManager.createMenu(fileMenuOptions);
  }

  /**
   * @returns {void}
   */
  showSensorMenu() {
    const settings = this.settingsManager.settings;
    const sensorMenuOptions = {
      "": { title: "Sensors" },
      "< Back": () => this.showMainMenu(),
      Accelerometer: {
        onchange: () => this.toggleSensor(SENSOR_TYPES.ACCELEROMETER),
        value: settings.record.includes(SENSOR_TYPES.ACCELEROMETER),
      },
      "Heart Rate": {
        onchange: () => this.toggleSensor(SENSOR_TYPES.HEART_RATE),
        value: settings.record.includes(SENSOR_TYPES.HEART_RATE),
      },
    };

    if (Bangle.getPressure) {
      sensorMenuOptions.Temperature = {
        onchange: () => this.toggleSensor(SENSOR_TYPES.TEMPERATURE),
        value: settings.record.includes(SENSOR_TYPES.TEMPERATURE),
      };
    }

    this.uiManager.createMenu(sensorMenuOptions);
  }

  /**
   * @params {string} sensorType
   *
   * @returns {void}
   */
  toggleSensor(sensorType) {
    const settings = this.settingsManager.settings;
    const index = settings.record.indexOf(sensorType);
    const action = index === -1 ? "enabled" : "disabled";

    if (index === -1) {
      settings.record.push(sensorType);
    } else {
      settings.record.splice(index, 1);
    }

    this.settingsManager.save();
    LogService.log(`Sensor ${sensorType} ${action}`);
    this.showSensorMenu();
  }

  /**
   * @param {boolean} newValue
   *
   * @returns {Promise<void>}
   */
  handleRecordingChange(newValue) {
    this.uiManager.showMessage("Updating...");

    WIDGETS.recorder.setRecording(newValue);
    LogService.log(`Recording ${newValue ? "started" : "stopped"}`);

    this.settingsManager.load();
    this.showMainMenu();
  }

  /**
   * @returns {void}
   */
  handlePeriodChange(newValue) {
    LogService.log(`Period changed to ${newValue}`);
    this.settingsManager.update("period", newValue);
    this.settingsManager.update("recording", false);
  }
}

class App {
  /**
   * @returns {Promise<void>}
   */
  static init() {
    Bangle.loadWidgets();
    Bangle.drawWidgets();

    NRF.wake();

    const settingsManager = new SettingsManager();
    settingsManager.load();

    const uiManager = new UIManager(settingsManager);
    const menuManager = new MenuManager(settingsManager, uiManager);
    LogService.log("App started");

    menuManager.showMainMenu();
  }
}

App.init().catch((error) => {
  LogService.log(`Error: ${error}`);
  E.showMessage("Error occurred");
});
