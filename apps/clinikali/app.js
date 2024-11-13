Bangle.loadWidgets();
Bangle.drawWidgets();

// Enable Bluetooth Low Energy
NRF.wake();

// Request pairing
NRF.security = { passkey: "123456", mitm: 1, display: 1 };

let appSettings;

function loadAppSettings() {
	appSettings = require("Storage").readJSON("clinikali.json", 1) || {};

	let settingsChanged = false;

	if (!appSettings.file) {
		settingsChanged = true;
		appSettings.file = "clinikali.log0.csv";
	}

	if (settingsChanged) {
		require("Storage").writeJSON("clinikali.json", appSettings);
	}
}

loadAppSettings();

function updateAppSettings() {
	require("Storage").writeJSON("clinikali.json", appSettings);

	if (WIDGETS.recorder) {
		WIDGETS.recorder.reload();
	}
}

function extractFileNumber(filename) {
	const matches = filename.match(/^clinikali\.log(.*)\.csv$/);

	if (matches) {
		return matches[1];
	}

	return 0;
}

function toggleRecorder(name) {
	const appSettings = loadAppSettings();

	// Initialize record array if it doesn't exist
	if (!appSettings.record) {
		appSettings.record = ["accel", "hrm", "baro"];
	}

	const index = appSettings.record.indexOf(name);
	if (index === -1) {
		// Add recorder
		appSettings.record.push(name);
	} else {
		// Remove recorder
		appSettings.record.splice(index, 1);
	}

	updateAppSettings(appSettings);
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
		"": { title: "Recorder" },
		"< Back": () => {
			load();
		},
		RECORD: {
			value: !!appSettings.recording,
			onchange: (newValue) => {
				setTimeout(() => {
					E.showMenu();

					WIDGETS.recorder.setRecording(newValue).then(() => {
						loadAppSettings();
						showMainMenu();
					});
				}, 1);
			},
		},
		File: { value: extractFileNumber(appSettings.file) },
		"View Files": () => {
			viewFiles();
		},
		Sensors: () => {
			showSensorMenu();
		},
		"Time Period": {
			value: appSettings.period || 10,
			min: 1,
			max: 120,
			step: 1,
			format: (value) => `${value}s`,
			onchange: (newValue) => {
				appSettings.recording = false; // stop recording if we change anything
				appSettings.period = newValue;
				updateAppSettings();
			},
		},
	};

	return E.showMenu(mainMenu);
}

function viewFile(filename) {
	E.showMenu({
		"": { title: `File ${extractFileNumber(filename)}` },
		"Send Data": () => {
			E.showMessage("Preparing...");

			function sendFileData() {
				const cleanFilename = filename.replace(" (StorageFile)", "");
				let file = require("Storage").open(cleanFilename, "r");

				if (!file) {
					E.showMessage("File not found!");
					setTimeout(() => viewFile(filename), 2000);
					return;
				}

				// Optimize BLE connection
				NRF.setConnectionInterval(7.5);
				NRF.setTxPower(4);

				// Get file size by reading lines
				let fileSize = 0;
				let line;
				while ((line = file.readLine()) !== undefined) {
					fileSize += line.length + 1; // +1 for newline
				}

				// Send file size header
				Bluetooth.println("START:" + fileSize);

				// Reset file for reading
				file = require("Storage").open(cleanFilename, "r");

				E.showMessage("Sending data...");
				let bytesSent = 0;

				function sendNextLines() {
					let chunk = "";
					let bytesInChunk = 0;
					const CHUNK_SIZE = 512;

					// Build chunk from lines
					while (bytesInChunk < CHUNK_SIZE) {
						line = file.readLine();
						if (line === undefined) {
							if (chunk.length > 0) {
								Bluetooth.write(chunk);
							}
							Bluetooth.println("END");
							E.showMessage("Data sent!");
							setTimeout(() => viewFile(filename), 2000);
							return;
						}
						chunk += line + "\n";
						bytesInChunk += line.length + 1;
					}

					// Send chunk
					Bluetooth.write(chunk);
					bytesSent += bytesInChunk;

					// Show progress
					const progress = Math.floor((bytesSent / fileSize) * 100);
					E.showMessage(`Sending: ${progress}%`);

					// Schedule next chunk
					setTimeout(sendNextLines, 10);
				}

				// Start sending
				sendNextLines();
			}

			sendFileData();
		},
		Delete: () => {
			E.showPrompt("Delete File?").then((shouldDelete) => {
				if (shouldDelete) {
					require("Storage").erase(filename);
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
		.list(/^clinikali\.log.*\.csv$/, { sf: true })
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
