/*
    * PPPConnection.js
    * This module manages a PPP connection using pppd.
    * It allows setting device, baud rate, local and remote IPs,
    * starting and stopping the PPP connection, and retrieving data transfer stats.
    * Used for the PPP feature in ArduPilot
*/
const { spawn, execSync } = require('child_process');
const { detectSerialDevices, getSerialPathFromValue } = require('./serialDetection.js')

class PPPConnection {
    constructor(settings) {
        this.settings = settings
        this.startGuard = null;
        this.isStarting = false;
        this.pendingDevice = null;
        this.startCancelled = false;
        this.retryTimer = null;
        this.wantEnabled = this.settings.value('ppp.enabled', false);
        this.isConnected = false;
        this.pppProcess = null;
        this.device = this.settings.value('ppp.uart', null);
        this.baudRate = this.settings.value('ppp.baud', 921600)
        this.localIP = this.settings.value('ppp.localIP', '192.168.144.14');  // default local IP
        this.remoteIP = this.settings.value('ppp.remoteIP', '192.168.144.15'); // default remote IP
        this.baudRates = [
            { value: 115200, label: '115200' },
            { value: 230400, label: '230400' },
            { value: 460800, label: '460800' },
            { value: 921600, label: '921600' },
            { value: 1500000, label: '1.5 MBaud' },
            { value: 2000000, label: '2 MBaud' },
            { value: 12500000, label: '12.5 MBaud' }];
        this.serialDevices = [];
        this.badbaudRate = false; // flag to indicate if the baud rate is not supported
        this.prevdata = null; // previous data for comparison
        this.isQuitting  = false;
        this.isManualStop = false; // flag to distinguish manual stop from process crash

        if (this.wantEnabled) {
            // Device detection is async, so the start guard (set right after
            // construction) is in place before the first start attempt.
            this.getDevices((err, devices) => {
                this.devices = devices;
                this.attemptAutoStart();
            });
        }
    }

    /**
     * @param {function} guard async ({device, path, localIP, remoteIP}) => error message or null;
     *   a rejected promise means the check itself failed and the start is retried
     */
    setStartGuard(guard) {
        this.startGuard = guard;
    }

    // Start from saved settings (boot, or after pppd exited unexpectedly).
    // A failed check is retried; a conflict or invalid setting disables PPP.
    attemptAutoStart() {
        this.retryTimer = null;
        if (this.isQuitting || !this.wantEnabled) {
            return;
        }
        this.startPPP(this.device, this.baudRate, this.localIP, this.remoteIP, (err) => {
            if (!err) {
                console.log('PPP connection started successfully');
            } else if (err.message.includes('already connected')) {
                console.log('PPP connection is already established. Retrying in 1 second...');
                this.scheduleAutoStart(1000);
            } else if (err.retryable) {
                console.error('PPP start check failed, retrying in 5 seconds: ' + err.message);
                this.scheduleAutoStart(5000);
            } else {
                console.error('Error starting PPP connection: ' + err.message);
                this.isConnected = false;
                this.wantEnabled = false;
                this.setSettings();
            }
        });
    }

    scheduleAutoStart(delayMs) {
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.attemptAutoStart(), delayMs);
    }

    currentState() {
        return {
            selDevice: this.device,
            selBaudRate: this.baudRate,
            localIP: this.localIP,
            remoteIP: this.remoteIP,
            enabled: this.isConnected,
            baudRates: this.baudRates,
            serialDevices: this.serialDevices,
        };
    }

    // Serial port reserved by PPP: the pending device during a start check,
    // otherwise the configured device while PPP is enabled or running
    getSerialPortClaim() {
        if (this.isStarting && this.pendingDevice) {
            return { ...this.pendingDevice };
        }
        if (!this.wantEnabled && !this.pppProcess && !this.isConnected) {
            return null;
        }
        return { device: this.device, path: getSerialPathFromValue(this.device, this.serialDevices) };
    }

    // PPP addresses that static IP configuration must not overlap, or null when PPP is disabled
    getActiveEndpoints() {
        if (!this.wantEnabled && !this.isConnected) {
            return null;
        }
        return { localIP: this.localIP, remoteIP: this.remoteIP };
    }

    setSettings() {
        this.settings.setValue('ppp.uart', this.device);
        this.settings.setValue('ppp.baud', this.baudRate);
        this.settings.setValue('ppp.localIP', this.localIP);
        this.settings.setValue('ppp.remoteIP', this.remoteIP);
        this.settings.setValue('ppp.enabled', this.wantEnabled);
    }

    quitting() {
        // stop the PPP connection if rpanion is quitting
        this.isQuitting = true;
        if (this.pppProcess) {
            console.log('Stopping PPP connection on quit...');
            // Remove all event listeners to prevent close handler from firing
            this.pppProcess.removeAllListeners();
            this.pppProcess.kill();
            this.pppProcess = null;
            try {
                execSync('sudo pkill -SIGTERM pppd && sleep 1');
            } catch (error) {
                console.error('Error stopping PPP connection on shutdown:', error);
            }
        }
    }

    async getDevices (callback) {
        // get all serial devices using hardwareDetection module
        try {
            this.serialDevices = await detectSerialDevices()
            return callback(null, this.serialDevices);
        } catch (error) {
            console.error('Error detecting serial devices:', error)
            return callback(error, []);
        }
    }

    startPPP(device, baudRate, localIP, remoteIP, callback) {
        this.badbaudRate = false;
        if (this.isConnected) {
            return callback(new Error('PPP is already connected'), this.currentState());
        }
        if (!device) {
            return callback(new Error('Device is required'), this.currentState());
        }
        if (this.pppProcess) {
            return callback(new Error('PPP still running. Please wait for it to finish.'), this.currentState());
        }
        if (this.isStarting) {
            return callback(new Error('PPP is already starting'), this.currentState());
        }

        //ensure device string is valid in the serialdevices list
        const devicePath = getSerialPathFromValue(device, this.serialDevices);
        if (!devicePath) {
            return callback(new Error('Invalid device selected'), this.currentState());
        }

        if (!this.startGuard) {
            return this.launchPPP(device, devicePath, baudRate, localIP, remoteIP, callback);
        }
        this.isStarting = true;
        this.startCancelled = false;
        this.pendingDevice = { device, path: devicePath };
        const finishCheck = () => {
            this.isStarting = false;
            this.pendingDevice = null;
            return this.startCancelled || this.isQuitting;
        };
        this.startGuard({ device, path: devicePath, localIP, remoteIP }).then((conflict) => {
            if (finishCheck()) {
                return callback(new Error('PPP start cancelled'), this.currentState());
            }
            if (conflict) {
                return callback(new Error(conflict), this.currentState());
            }
            return this.launchPPP(device, devicePath, baudRate, localIP, remoteIP, callback);
        }, (err) => {
            const cancelled = finishCheck();
            const error = new Error(cancelled ? 'PPP start cancelled' : 'Could not verify PPP configuration: ' + (err.message || err));
            error.retryable = !cancelled;
            return callback(error, this.currentState());
        });
    }

    launchPPP(device, devicePath, baudRate, localIP, remoteIP, callback) {
        this.device = device;
        this.baudRate = baudRate;
        this.localIP = localIP;
        this.remoteIP = remoteIP;
        
        const args = [
            "pppd",
            devicePath,
            this.baudRate, // baud rate
            //'persist',          // enables faster termination
            //'holdoff', '1',     // minimum delay of 1 second between connection attempts
            this.localIP + ':' + this.remoteIP, // local and remote IPs
            'local',
            'noauth',
            //'debug',
            'crtscts',
            'nodetach',
            'ktune'
        ];
        // if running in dev env, need to preload sudo login
        if (process.env.NODE_ENV === 'development') {
            execSync('sudo -v');
        }
        console.log(`Starting PPP with args: ${args.join(' ')}`);
        this.pppProcess = spawn('sudo', args, {
        //detached: true,
        stdio: ['ignore', 'pipe', 'pipe'] // or 'ignore' for all three to fully detach
        });
        this.pppProcess.stdout.on('data', (data) => {
            console.log("PPP Output: ", data.toString().trim());
            // Check for non support baud rates "speed <baud> not supported"
            if (data.toString().includes('speed') && data.toString().includes('not supported')) {
                this.pppProcess.kill();
                this.pppProcess = null; // reset the process reference
                this.isConnected = false;
                this.badbaudRate = true;
            }
        });
        this.pppProcess.stderr.on('data', (data) => {
            console.log("PPP Error: ", data.toString().trim());
        });
        this.pppProcess.on('close', (code, signal) => {
            console.log(`PPP process exited with code: ${code}, signal: ${signal} (isQuitting: ${this.isQuitting}, isManualStop: ${this.isManualStop})`);
            // Don't treat signal-based terminations as unexpected (code 5 is typical for SIGTERM/SIGINT)
            // These usually happen during application shutdown when Ctrl+C is pressed
            const isSignalTermination = signal !== null || code === 5 || code === 2;
            const wasManualStop = this.isManualStop;
            this.pppProcess = null;
            this.isManualStop = false;
            if (!this.isQuitting && !wasManualStop && !isSignalTermination) {
                // Unexpected exit - retry without persisting disabled state
                console.log('PPP process exited unexpectedly. Retrying in 5 seconds...');
                this.isConnected = false;
                this.scheduleAutoStart(5000);
            } else {
                this.isConnected = false;
                this.setSettings();
            }
        });
        this.isConnected = true;
        this.wantEnabled = true;
        this.setSettings();
        return callback(null, this.currentState());
    }

    stopPPP(callback) {
        if (this.isStarting) {
            // Start check still pending: cancel it instead of killing a process
            this.startCancelled = true;
            this.wantEnabled = false;
            this.setSettings();
            return callback(null, this.currentState());
        }
        if (!this.isConnected && !this.pppProcess && this.wantEnabled) {
            // Enabled but waiting for a retry: cancel it so the port is released
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
            this.wantEnabled = false;
            this.setSettings();
            return callback(null, this.currentState());
        }
        if (!this.isConnected) {
            return callback(new Error('PPP is not connected'), this.currentState());
        }
        if (this.pppProcess) {
            // Gracefully kill the PPP process
            console.log('Stopping PPP connection...');
            // Set flag to prevent the close event handler from updating state
            this.isManualStop = true;
            this.pppProcess.kill();
            execSync('sudo pkill -SIGTERM pppd');
            this.isConnected = false;
            this.wantEnabled = false;
            this.setSettings();
        }
        return callback(null, this.currentState());
    }

    getPPPdatarate(callback) {
        if (!this.isConnected) {
            return callback(new Error('PPP is not connected'));
        }
        // get current data transfer stats for connected PPP session
        return new Promise((resolve, reject) => {
            exec('ifconfig ppp0', (error, stdout, stderr) => {
                if (error) {
                    reject(`Error getting PPP data rate: ${stderr}`);
                } else {
                    // match format RX packets 110580  bytes 132651067 (132.6 MB)
                    const match = stdout.match(/RX packets \d+  bytes (\d+) \(\d+\.\d+ MB\).*TX packets \d+  bytes (\d+) \(\d+\.\d+ MB\)/);
                    if (match) {
                        const rxBytes = parseInt(match[1], 10);
                        const txBytes = parseInt(match[5], 10);
                        resolve({ rxBytes, txBytes });
                    } else {
                        reject('Could not parse PPP data rate');
                    }
                }
            });
        });
    }

    getPPPSettings(callback) {
        this.getDevices((err, devices) => {
            if (err) {
                console.error('Error fetching serial devices:', err);
                return callback(err, {
                    selDevice: null,
                    selBaudRate: this.baudRate,
                    localIP: this.localIP,
                    remoteIP: this.remoteIP,
                    enabled: this.wantEnabled,
                    baudRates: this.baudRates,
                    serialDevices: [],
                });
            }
            
            this.serialDevices = devices;
            
            // Set default device if not already set
            if (!this.device && this.serialDevices.length > 0) {
                this.device = this.serialDevices[0].value;
            }
            
            // if this.device is not in the list, set it to first available device
            if (this.device && !this.serialDevices.some(d => d.value === this.device)) {
                this.device = this.serialDevices[0].value;
            }
            
            // Always return callback
            return callback(null, {
                selDevice: this.device,
                selBaudRate: this.baudRate,
                localIP: this.localIP,
                remoteIP: this.remoteIP,
                enabled: this.wantEnabled,
                baudRates: this.baudRates,
                serialDevices: this.serialDevices,
            });
        });
    }

    // uses ifconfig to get the PPP connection datarate
    getPPPDataRate() {
        if (!this.isConnected) {
            return { rxRate: 0, txRate: 0 };
        }
        // get current data transfer stats for connected PPP session
        try {
            let stdout = execSync('ifconfig ppp0 | grep packets', { encoding: 'utf8' }).toString().trim();
            if (!stdout) {
                return { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0 };
            }
            // match format :
            //        RX packets 0  bytes 0 (0.0 B)
            //        TX packets 118  bytes 12232 (12.2 KB)
            const [ , matchRX, matchTX ] = stdout.match(/RX\s+packets\s+\d+\s+bytes\s+(\d+).*TX\s+packets\s+\d+\s+bytes\s+(\d+)/s);
            if (matchRX && matchTX) {
                const rxBytes = parseInt(matchRX);
                const txBytes = parseInt(matchTX);
                // calculate the data rate in bytes per second
                if (this.prevdata) {
                    const elapsed = Date.now() - this.prevdata.timestamp; // in milliseconds
                    const rxRate = (rxBytes - this.prevdata.rxBytes) / (elapsed / 1000); // bytes per second
                    const txRate = (txBytes - this.prevdata.txBytes) / (elapsed / 1000); // bytes per second
                    const percentusedRx = rxRate / (this.baudRate / 8); // percent of baud rate used
                    const percentusedTx = txRate / (this.baudRate / 8); // percent of baud rate used
                    this.prevdata = { rxBytes, txBytes, timestamp: Date.now() };
                    return { rxRate, txRate, percentusedRx, percentusedTx };
                }
                this.prevdata = { rxBytes, txBytes, timestamp: Date.now() };
                return { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0 };
            } else {
                return { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0};
            }
        } catch (error) {
            console.error('Error getting PPP data rate:', error.message);
            return { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0 };
        }
    }

    // Returns a string representation of the PPP connection status for use by socket.io
    conStatusStr () {
        //format the connection status string
        if (this.badbaudRate) {
            return 'Disconnected (Baud rate not supported)';
        }
        if (!this.isConnected) {
            return 'Disconnected';
        }
        if (this.pppProcess && this.pppProcess.pid) {
            //get datarate
            const { rxRate, txRate, percentusedRx, percentusedTx } = this.getPPPDataRate();
            let status = 'Connected';
            if (this.pppProcess.pid) {
                status += ` (PID: ${this.pppProcess.pid})`;
            }
            if (rxRate > 0 || txRate > 0) {
                status += `, RX: ${rxRate.toFixed(2)} B/s (${(percentusedRx * 100).toFixed(2)}%), TX: ${txRate.toFixed(2)} B/s (${(percentusedTx * 100).toFixed(2)}%)`;
            } else {
                status += ', No data transfer';
            }
            return status;
        }
        else {
            return 'Disconnected';
        }
    }
}


module.exports = PPPConnection;