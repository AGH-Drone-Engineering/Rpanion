const { exec, execSync, execFile } = require('child_process')
const fs = require('fs')
const settings = require('settings-store')

function getAdapters (callback) {
  // Get all network adapter name, type and states
  exec('sudo nmcli -t -f device,type,state dev', (error, stdout, stderr) => {
    const netStatusList = []
    if (stderr) {
      console.error(`exec error: ${error}`)
      return callback(stderr)
    } else {
      stdout.split('\n').forEach(function (item) {
        const device = item.split(':')
        if (device.length === 3 && device[1] !== 'loopback' && device[1] !== 'bridge' && device[1] !== 'wifi-p2p' && device[1] !== 'can0' && device[1] !== 'can1') {
          console.log('Adding Network device ' + device[0])
          // if wifi, check for avail channels
          const freqList = []
          freqList.push({ value: 0, freq: 0, label: 'auto', band: 0 })
          if (device[1] === 'wifi') {
            try {
              const output = execSync('iw list | grep -E "MHz \\["')
              const allFreqs = output.toString().split('\n')
              // output format is "			* 5745.0 MHz [149] (20.0 dBm)"
              for (let i = 0, len = allFreqs.length; i < len; i++) {
                if (allFreqs[i].includes('MHz')) {
                  const ln = allFreqs[i].split(' ').filter(i => i)
                  if (ln.length > 4) {
                    freqList.push({ value: parseInt(ln[3].replace('[', '').replace(']', '')), freq: ln[1], label: '' + ln[3].replace('[', '').replace(']', '') + ' (' + ln[1] + ' MHz)', band: ((parseFloat(ln[1]) < 3000) ? 'bg' : 'a') })
                  }
                }
              }
            } catch (e) {
              console.error('exec error: ' + e)
              return callback(e)
            }
          }
          netStatusList.push({ value: device[0], label: device[0] + ' (' + device[1] + ')', type: device[1], state: device[2], channels: freqList, isDisabled: !!((device[2] === 'unavailable' && device[1] === 'wifi')) })
        }
      })
    }
    return callback(null, netStatusList)
  })
}

function getWirelessStatus (callback) {
  // get the "flight mode" status of the wireless (wifi) adapters
  exec('sudo nmcli -t radio wifi', (error, stdout, stderr) => {
    if (stderr) {
      console.error(`exec error: ${error}`)
      return callback(stderr)
    } else {
      console.log('Wifi is ' + stdout)
      if (stdout === 'enabled\n') {
        return callback(null, true)
      } else {
        return callback(null, false)
      }
    }
  })
}

function setWirelessStatus (status, callback) {
  exec('sudo nmcli radio wifi ' + ((status === true) ? 'on' : 'off') + ' && sudo nmcli -t radio wifi', (error, stdout, stderr) => {
    if (stderr) {
      console.error(`exec error: ${error}`)
      return callback(stderr)
    } else {
      if (stdout === 'enabled\n') {
        return callback(null, true)
      } else {
        return callback(null, false)
      }
    }
  })
}

function resetWifiWatchdogState () {
  const paths = [
    '/run/rpanion-wifi/connected-client',
    '/run/rpanion-wifi/disconnect-time',
    '/run/rpanion-wifi-connected-client',
    '/run/rpanion-wifi-disconnect-time'
  ];
  paths.forEach((p) => {
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    } catch (e) {
      // Ignore cleanup error
    }
  });
}

function activateConnection (conName, callback) {
  resetWifiWatchdogState();
  // activate the connection (by id)
  // assumed that conName is a valid UUID
  execFile('sudo', ['nmcli', '-g', 'connection.id', 'connection', 'show', conName], (errShow, stdoutShow) => {
    const conId = (stdoutShow || '').trim();
    const autoVal = (conId === 'WiFiAP') ? 'no' : 'yes';
    execFile('sudo', ['nmcli', 'connection', 'mod', conName, 'connection.autoconnect', autoVal], (error, stdout, stderr) => {
    if (stderr) {
      console.error(`exec error: ${error}`)
      return callback(stderr)
    } else {
      execFile('sudo', ['nmcli', 'connection', 'up', conName], (error, stdout, stderr) => {
        if (stderr || error) {
          const rawErr = stderr || (error && error.message) || 'Activation failed';
          console.error(`exec error in connection up: ${rawErr}`);

          let errMsg = rawErr;
          if (rawErr.includes('IP configuration could not be reserved') || rawErr.includes('no available address, timeout')) {
            errMsg = 'DHCP timeout: No response from DHCP server. An IP address could not be obtained.';
          }

          execFile('sudo', ['nmcli', '-g', 'connection.type', 'connection', 'show', conName], (errType, stdoutType) => {
            const conType = (stdoutType || '').trim();
            if (conType === '802-11-wireless') {
              execFile('sudo', ['nmcli', 'connection', 'up', 'WiFiAP'], (errAP) => {
                console.log('Rolled back to WiFiAP due to Wi-Fi activation failure of ' + conName);
                return callback(errMsg);
              });
            } else {
              return callback(errMsg);
            }
          });
        } else {
          console.log('Activated network: ' + conName)
          return callback(null, 'OK')
        }
      })
    }
  })
  })
}

function deactivateConnection (conName, callback) {
  // deactivate the connection (by id)
  // assumed that conName is a valid UUID
  execFile('sudo', ['nmcli', '-g', 'connection.id', 'connection', 'show', conName], (errShow, stdoutShow) => {
    const conId = (stdoutShow || '').trim();
    if (conId === 'Ethernet-Server' || conId === 'WiFiAP') {
      console.log('Blocked deactivation of fallback profile: ' + conId);
      return callback('Cannot deactivate fallback profile: ' + conId);
    }
    // need to disable auto-connect too
    execFile('sudo', ['nmcli', 'connection', 'mod', conName, 'connection.autoconnect', 'no'], (error, stdout, stderr) => {
      if (stderr) {
        console.error(`exec error: ${error}`)
        return callback(stderr)
      } else {
        execFile('sudo', ['nmcli', 'connection', 'down', conName], (error, stdout, stderr) => {
          if (stderr) {
            console.error(`exec error: ${error}`)
            return callback(stderr)
          } else {
            console.log('Dectivated network: ' + conName)
            return callback(null, 'OK')
          }
        })
      }
    })
  })
}

function getPrimaryWifiDevice(callback) {
  exec('iw dev | grep Interface | awk \'{print $2}\'', (error, stdout, stderr) => {
      if (error) {
          console.error(`exec error: ${error}`)
          return callback(error)
      }
      if (stderr) {
          console.error(`stderr: ${stderr}`)
          return callback(new Error(stderr))
      }
      const device = stdout.trim().split('\n')[0]
      callback(null, device)
  });
}

function getWifiScan(callback) {
  const parseIw = (stdout) => {
    const rawNetworks = [];
    let current = null;

    (stdout || '').split('\n').forEach(line => {
      line = line.trim();

      if (line.startsWith('BSS ')) {
        if (current) rawNetworks.push(current);
        current = { ssid: null, signal: null, security: 'Open' };
        return;
      }

      if (!current) return;

      if (line.startsWith('SSID:')) {
        current.ssid = line.slice(5).trim();
        // if not ascii, return
        if (!/^[\x00-\x7F]*$/.test(current.ssid)) {
          current.ssid = null;
          return;
        }
      }

      if (line.startsWith('signal:')) {
        const dBm = parseFloat(line.split(' ')[1]);
        current.signal = dBm;
      }

      if (line.includes('RSN:')) {
        current.security = 'WPA2';
      } else if (line.includes('WPA:')) {
        current.security = 'WPA';
      } else if (line.includes('WEP:')) {
        current.security = 'WEP';
      }
    });
    if (current) rawNetworks.push(current);

    const deduped = new Map();
    rawNetworks.forEach(net => {
      if (!net.ssid || net.ssid === 'rpanion' || net.ssid === 'WiFiAP') return;
      if (!deduped.has(net.ssid) || deduped.get(net.ssid).signal < net.signal) {
        deduped.set(net.ssid, net);
      }
    });

    return Array.from(deduped.values()).sort((a, b) => b.signal - a.signal);
  };

  const fallbackNmcli = () => {
    const parseNmcli = (stdout) => {
      const networks = [];
      const seenSSIDs = new Set();

      (stdout || '').split('\n').forEach(line => {
        line = line.trim();
        if (!line) return;

        const parts = line.split(/(?<!\\):/);
        if (parts.length >= 3) {
          const ssid = parts[0].replace(/\\:/g, ':').trim();
          if (!ssid || ssid === '--' || ssid === 'rpanion' || ssid === 'WiFiAP') return;
          if (!/^[\x00-\x7F]*$/.test(ssid)) return;
          if (seenSSIDs.has(ssid)) return;
          seenSSIDs.add(ssid);

          const signalVal = parseInt(parts[1], 10);
          const rawSec = parts[2] || '';
          let security = 'Open';
          if (rawSec.includes('WPA3')) {
            security = 'WPA3';
          } else if (rawSec.includes('WPA2') || rawSec.includes('RSN')) {
            security = 'WPA2';
          } else if (rawSec.includes('WPA')) {
            security = 'WPA';
          } else if (rawSec.includes('WEP')) {
            security = 'WEP';
          }

          networks.push({
            ssid: ssid,
            signal: isNaN(signalVal) ? 0 : signalVal,
            security: security
          });
        }
      });
      return networks.sort((a, b) => b.signal - a.signal);
    };

    // Always trigger active rescan and wait 2s for wpa_supplicant to discover all in-range networks
    exec('nmcli dev wifi rescan 2>/dev/null || true; sleep 2; nmcli -t -c no -f SSID,SIGNAL,SECURITY dev wifi list', (err, stdout) => {
      if (err && !stdout) {
        console.error(`nmcli wifi list error: ${err}`);
        return callback(err);
      }
      callback(null, parseNmcli(stdout));
    });
  };

  getPrimaryWifiDevice((error, device) => {
    if (error || !device) {
      return fallbackNmcli();
    }

    exec(`sudo iw dev ${device} scan ap-force`, (error, stdout, stderr) => {
      if (error || stderr) {
        return fallbackNmcli();
      }

      const networks = parseIw(stdout);
      if (networks.length === 0) {
        return fallbackNmcli();
      }

      callback(null, networks);
    });
  });
}

function addConnection (conNameStr, conType, conAdapter, conSettings, callback) {
  // add a new connection with name conNameStr and settings
  // conSettings
  // nmcli connection add type wifi ifname $IFNAME con-name $APNAME ssid $SSID
  // due to the multiple edits, we need to set autoconnect to "no"
  if (conType === 'wifi') {
    resetWifiWatchdogState();
    if (conSettings.priority === undefined || conSettings.priority === null || conSettings.priority === '') {
      conSettings.priority = conSettings.mode === 'ap' ? 0 : 100;
    }
    // Build nmcli command gradually for readability
    // Build argument array for nmcli command
    let nmcliArgs = ['connection', 'add', 'type', conType, 'ifname', conAdapter, 'con-name', conNameStr, 'ssid', conSettings.ssid, '802-11-wireless.mode', conSettings.mode];

    if (conSettings.band !== undefined && conSettings.band !== null) {
      nmcliArgs.push('802-11-wireless.band', conSettings.band);
    }

    if (conSettings.channel !== undefined && conSettings.channel !== null) {
      const channelValue = conSettings.channel === '0' ? '' : conSettings.channel;
      nmcliArgs.push('802-11-wireless.channel', channelValue);
    }

    nmcliArgs.push('ipv4.method', conSettings.ipaddresstype, 'connection.autoconnect', 'no');

    // run nmcli connection add safely
    execFile('sudo', ['nmcli', ...nmcliArgs], (error, stdout, stderr) => {
      if (error || stderr) {
        console.error(`execFile error: ${error || stderr}`);
        return callback(error || stderr);
      } else {
        // After connection added, get the connection UUID.
        execFile('sudo', ['nmcli', '-g', 'connection.uuid', 'con', 'show', conNameStr], (error2, stdout2, stderr2) => {
          if (error2 || stderr2) {
            console.error(`execFile error (uuid): ${error2 || stderr2}`);
            return callback(error2 || stderr2);
          } else {
            const conUUID = stdout2.split('\n')[stdout2.split('\n').length - 2];
            console.log('Added network Wifi: ' + conNameStr + ' - ' + conAdapter + ' - ' + conUUID);
            this.editConnection(conUUID, conSettings, (err) => {
              // set autoconnect back to "yes"
              execFile('sudo', ['nmcli', 'connection', 'mod', conUUID, 'connection.autoconnect', 'yes'], (error3, stdout3, stderr3) => {
                if (!err && !error3 && !stderr3) {
                  console.log('addConnection() wifi OK');
                  return callback(null, 'AddOK');
                } else {
                  console.log('Error in editConnection() wifi addcon ', { message: err });
                  console.log('Error in editConnection() wifi addcon ', { message: error3 || stderr3 });
                  return callback(err || error3 || stderr3);
                }
              });
            });
          }
        });
      }
    });
  } else {
    if (conSettings.priority === undefined || conSettings.priority === null || conSettings.priority === '') {
      conSettings.priority = 100;
    }
    exec('sudo nmcli connection add type ' + conType + ' ifname ' + conAdapter +
             ' con-name ' + conNameStr + ' connection.autoconnect no ' + '&&' +
             'sudo nmcli -g connection.uuid con show ' + conNameStr, (error, stdout, stderr) => {
      if (stderr) {
        console.error(`exec error: ${error}`)
        return callback(stderr)
      } else {
        // once the network is created, add in the settings
        const conUUID = stdout.split('\n')[stdout.split('\n').length - 2]
        console.log('Added network Wired: ' + conNameStr + ' - ' + conAdapter + ' - ' + conUUID)
        this.editConnection(conUUID, conSettings, (err) => {
          // set autoconnect back to "yes"
          exec('sudo nmcli connection mod ' + conUUID + ' connection.autoconnect yes', (error, stdout, stderr) => {
            if (!err && !stderr) {
              console.log('addConnection() wired OK')
              return callback(null, 'AddOK')
            } else {
              console.log('Error in editConnection() wired addcon ', { message: err })
              console.log('Error in editConnection() wired addcon ', { message: stderr })
              return callback(err)
            }
          })
        })
      }
    })
  }
}

function editConnection (conName, conSettings, callback) {
  resetWifiWatchdogState();
  // edit an existing connection
  // assumed that conName is a valid UUID
  // there are 5 types of edits - AttachedInterface, IP, Wifi security, Wifi AP, Priority
  execFile('sudo', ['nmcli', '-g', 'connection.id', 'connection', 'show', conName], (errShow, stdoutShow) => {
    const conId = (stdoutShow || '').trim();
    if (conId === 'Ethernet-Server' && conSettings.ipaddresstype && conSettings.ipaddresstype !== 'shared') {
      console.log('Blocked modification of IP mode for fallback profile: ' + conId);
      return callback('Cannot modify IP mode for fallback profile: ' + conId);
    }

    const proceedEdit = () => {
      console.log(conSettings)
      editConnectionAttached(conName, conSettings, (errAttach) => {
        console.log('Attach')
        if (!errAttach) {
          editConnectionIP(conName, conSettings, (errIP) => {
            console.log('IP')
            if (!errIP) {
              editConnectionPSK(conName, conSettings, (errPSK) => {
                console.log('PSK')
                if (!errPSK) {
                  editConnectionAPClient(conName, conSettings, (errAP) => {
                    console.log('AP')
                    if (!errAP) {
                      editConnectionPriority(conName, conSettings, (errPriority) => {
                        console.log('Priority')
                        if (errPriority) {
                          return callback(errPriority)
                        }
                        // If this connection is currently active, reactivate it to apply new settings to the live device
                        execFile('sudo', ['nmcli', '-t', '-f', 'GENERAL.STATE', 'connection', 'show', conName], (errDev, stdoutDev) => {
                          if ((stdoutDev || '').includes('activated')) {
                            console.log('Re-applying modified active connection: ' + conName)
                            execFile('sudo', ['nmcli', 'connection', 'up', conName], (errUp) => {
                              if (errUp) console.warn('Warning: nmcli connection up returned: ' + errUp)
                              return callback(null, 'EditOK')
                            })
                          } else {
                            return callback(null, 'EditOK')
                          }
                        })
                      })
                    } else {
                      return callback(errAP)
                    }
                  })
                } else {
                  console.log('Error in editConnection() errPSK ', { message: errPSK })
                  return callback(errPSK)
                }
              })
            } else {
              console.log('Error in editConnection() errIP ', { message: errIP })
              return callback(errIP)
            }
          })
        } else {
          console.log('Error in editConnection() errAttach ', { message: errAttach })
          return callback(errAttach)
        }
      })
    };

    if (conSettings.priority !== undefined && conSettings.priority !== '') {
      const newPrio = parseInt(conSettings.priority);
      if (conId === 'Ethernet-Server') {
        return execFile('sudo', ['nmcli', '-g', 'connection.autoconnect-priority', 'connection', 'show', 'Ethernet-Client'], (errClient, stdoutClient) => {
          if (!errClient && stdoutClient) {
            const clientPrio = parseInt(stdoutClient.trim());
            if (!isNaN(clientPrio) && newPrio >= clientPrio) {
              return callback(`Ethernet-Server priority (${newPrio}) must be lower than Ethernet-Client priority (${clientPrio})`);
            }
          }
          proceedEdit();
        });
      } else if (conId === 'Ethernet-Client') {
        return execFile('sudo', ['nmcli', '-g', 'connection.autoconnect-priority', 'connection', 'show', 'Ethernet-Server'], (errServer, stdoutServer) => {
          if (!errServer && stdoutServer) {
            const serverPrio = parseInt(stdoutServer.trim());
            if (!isNaN(serverPrio) && newPrio <= serverPrio) {
              return callback(`Ethernet-Client priority (${newPrio}) must be higher than Ethernet-Server priority (${serverPrio})`);
            }
          }
          proceedEdit();
        });
      }
    }

    proceedEdit();
  })
}

function editConnectionPriority (conName, conSettings, callback) {
  if (conSettings.priority !== undefined && conSettings.priority !== null && conSettings.priority !== '') {
    execFile('sudo', ['nmcli', 'connection', 'mod', conName, 'connection.autoconnect-priority', conSettings.priority.toString()], (error, stdout, stderr) => {
      if (stderr || error) {
        console.error(`exec error in editConnectionPriority: ${error || stderr}`)
        return callback(stderr || error)
      } else {
        console.log('Edited network Priority: ' + conName + ' to ' + conSettings.priority)
        return callback(null, 'EditPriorityOK')
      }
    })
  } else {
    return callback(null, 'EditNotRequired')
  }
}

function editConnectionAttached (conName, conSettings, callback) {
  // edit the attached interface for a connection
  let iface = conSettings.attachedIface;
  if (!iface || iface === '&quot;&quot;' || iface === 'undefined' || iface === '""' || iface === '\"\"') {
    iface = '';
  }

  execFile('sudo', ['nmcli', 'connection', 'mod', conName, 'connection.interface-name', iface], (error, stdout, stderr) => {
    if (stderr) {
      console.error(`exec error: ${error}`)
      return callback(stderr)
    } else {
      console.log('Edited network Attachment: ' + conName + ' to ' + (iface || '(any)'))
      return callback(null, 'EditAttachOK')
    }
  })
}

function editConnectionIP (conName, conSettings, callback) {
  // first sort out the IP Addressing (DHCP/static) for LAN and Wifi Client
  if (!conSettings.ssid || Object.keys(conSettings.ssid).length === 0 || conSettings.mode === 'infrastructure') {
    if (conSettings.ipaddresstype === 'auto') {
      execFile('sudo', ['nmcli', 'connection', 'mod', conName, 'ipv4.method', 'auto', 'ipv4.addresses', ''], (error, stdout, stderr) => {
        if (stderr) {
          console.error(`exec error: ${error}`)
          return callback(stderr)
        } else {
          console.log('Edited network IP Auto: ' + conName)
          return callback(null, 'EditOK')
        }
      })
    } else if (conSettings.ipaddress && Object.keys(conSettings.ipaddress).length !== 0 && conSettings.subnet && Object.keys(conSettings.subnet).length !== 0) {
      execFile('sudo', ['nmcli', 'connection', 'mod', conName, 'ipv4.addresses', conSettings.ipaddress + '/' +
        netmask2CIDR(conSettings.subnet), 'ipv4.method', conSettings.ipaddresstype], (error, stdout, stderr) => {
        if (stderr) {
          console.error(`exec error: ${error}`)
          return callback(stderr)
        } else {
          console.log('Edited network IP manual: ' + conName)
          return callback(null, 'EditOK')
        }
      })
    }
  } else {
    console.log('editConnectionIP() not required')
    return callback(null, 'EditNotRequired')
  }
}

function editConnectionPSK (conName, conSettings, callback) {
  // now sort out Wifi client/ap settings - password and security type
  if (!conSettings.mode || Object.keys(conSettings.mode).length === 0) {
    return callback(null, 'EditNotRequired')
  }
  if (conSettings.mode === 'infrastructure' || conSettings.mode === 'ap') {
    // psk network
    if (conSettings.wpaType !== 'none' &&
            conSettings.ssid && Object.keys(conSettings.ssid).length !== 0 &&
            conSettings.password && Object.keys(conSettings.password).length !== 0) {
            execFile('sudo', ['nmcli', 'connection', 'mod', conName, '802-11-wireless-security.key-mgmt', conSettings.wpaType], (error, stdout, stderr) => {
        if (stderr) {
          console.error(`exec error: ${error}`)
          return callback(stderr)
        } else {
          execFile('sudo', ['nmcli', '-s', 'connection', 'mod', conName, '802-11-wireless-security.pairwise', 'ccmp', '802-11-wireless-security.psk', conSettings.password], (error, stdout, stderr) => {
            if (stderr) {
              console.error(`exec error: ${error}`)
              return callback(stderr)
            } else {
              console.log('Edited Wifi psk: ' + conName)
              return callback(null, 'OK')
            }
          })
        }
      })
    }
    else if (conSettings.wpaType === 'none' &&
                 conSettings.ssid && Object.keys(conSettings.ssid).length !== 0) {
      execFile('sudo', ['nmcli', 'connection', 'mod', conName, 'remove', '802-11-wireless-security'], (error, stdout, stderr) => {
        if (stderr) {
          console.error(`exec error: ${error}`)
          return callback(stderr)
        } else {
          console.log('Edited Wifi no-psk: ' + conName)
          return callback(null, 'OK')
        }
      })
    }
  } else {
    console.log('editConnectionPSK() not required')
    return callback(null, 'EditNotRequired')
  }
}

function editConnectionAPClient (conName, conSettings, callback) {
  // now sort out Wifi ap or client settings - ssid, band, starting ip
  if (!conSettings.mode || Object.keys(conSettings.mode).length === 0) {
    return callback(null, 'EditNotRequired')
  }
  if (conSettings.mode === 'ap') {
    if (conSettings.ssid && Object.keys(conSettings.ssid).length !== 0 &&
            conSettings.band && Object.keys(conSettings.band).length !== 0 &&
            conSettings.channel && Object.keys(conSettings.channel).length !== 0 &&
            conSettings.ipaddress && Object.keys(conSettings.ipaddress).length !== 0) {
      const cmds = ['nmcli', 'connection', 'mod', conName, '802-11-wireless.ssid', conSettings.ssid,
        '802-11-wireless.band', conSettings.band, 'ipv4.addresses', conSettings.ipaddress + '/24']
      cmds.push('802-11-wireless.channel', conSettings.channel !== '0' ? conSettings.channel : "")
      if (conSettings.wpaType !== 'none') {
        cmds.push('802-11-wireless-security.group', 'ccmp', '802-11-wireless-security.wps-method', '1')
      }
      execFile('sudo', cmds, (error, stdout, stderr) => {
        if (stderr) {
          console.error(`exec error: ${error}`)
          return callback(stderr)
        } else {
          console.log('Edited Wifi ap ssid/band: ' + conName)
          return callback(null, 'OK')
        }
      })
    } else {
      console.log('Badsettings in editConnectionAPClient')
      console.log(conSettings)
      return callback(null, 'BADARGS')
    }
  } else {
    // client connection - edit ssid if required
    if (conSettings.ssid && Object.keys(conSettings.ssid).length !== 0) {
      execFile('sudo', ['nmcli', 'connection', 'mod', conName, '802-11-wireless.ssid', conSettings.ssid], (error, stdout, stderr) => {
        if (stderr) {
          console.error(`exec error: ${error}`)
          return callback(stderr)
        } else {
          console.log('Edited Wifi client ssid: ' + conName)
          return callback(null, 'OK')
        }
      })
    } else {
      console.log('Badsettings in editConnectionAPClient')
      console.log(conSettings)
      return callback(null, 'BADARGS')
    }
  }
}

function deleteConnection (conName, callback) {
  resetWifiWatchdogState();
  // delete the connection (by id)
  // assumed that conName is a valid UUID
  execFile('sudo', ['nmcli', '-g', 'connection.id', 'connection', 'show', conName], (errShow, stdoutShow) => {
    const conId = (stdoutShow || '').trim();
    if (conId === 'Ethernet-Server' || conId === 'Ethernet-Client' || conId === 'WiFiAP') {
      console.log('Blocked deletion of system profile: ' + conId);
      return callback('Cannot delete system profile: ' + conId);
    }
    execFile('sudo', ['nmcli', 'connection', 'delete', conName], (error, stdout, stderr) => {
      if (stderr) {
        console.error(`exec error: ${error}`);
        return callback(stderr);
      } else {
        console.log('Deleted network: ' + conName);
        return callback(null, 'OK');
      }
    });
  });
}

function getConnections (callback) {
  let output = ''
  const conStatusList = []
  try {
    output = execSync('sudo nmcli -t -f NAME,UUID,TYPE,DEVICE connection show')
  } catch (e) {
    console.error('exec error: ' + e)
    return callback(e)
  }

  const allConns = output.toString().split('\n')
  for (let i = 0, len = allConns.length; i < len; i++) {
    const item = allConns[i]
    const connection = item.split(':')
    let curConn = {}
    let subout = ''
    if (connection.length == 4 || connection.length == 3) {
      try {
        subout = execSync('sudo nmcli -s -t -f connection.interface-name connection show ' + connection[1])
        subout = subout.toString().split(':')[1].trim()
      } catch (e) {
        console.error('exec error: ' + e)
        // return callback("");
      }
    }
    if (connection[3] === '' || connection[3] === '--') {
      curConn = { value: connection[1], label: '', labelPre: connection[0], type: connection[2], state: '', attachedIface: subout }
      conStatusList.push(curConn)
    } else if (connection.length === 4) {
      // active connection
      curConn = { value: connection[1], label: '', labelPre: connection[0], type: connection[2], state: connection[3], attachedIface: subout }
      conStatusList.push(curConn)
    }
    // if we're at the end, return callback
    if (i === allConns.length - 1) {
      console.log('getConnections() got: ' + allConns.length)
      return callback(null, conStatusList)
    }
  }
}

function getConnectionDetails (conName, callback) {
  execFile('sudo', ['nmcli', '-s', '-t', '-f', 'ipv4.addresses,802-11-wireless.band,ipv4.method,IP4.ADDRESS,802-11-wireless.ssid,802-11-wireless.mode,802-11-wireless-security.key-mgmt,802-11-wireless-security.psk,connection.interface-name,802-11-wireless.channel,connection.autoconnect-priority', 'connection', 'show', conName], (error, stdout, stderr) => {
    if (stderr) {
      // no connection with that name
      console.error(`exec error: ${error}`)
      return callback(stderr)
    } else {
      const ret = { DHCP: 'auto', IP: '', subnet: '', mode: '', wpaType: 'none', password: '', priority: 0 }
      let configuredIP = ''
      let configuredSubnet = ''
      let activeIP = ''
      let activeSubnet = ''

      stdout.split('\n').forEach(function (item) {
        if (item.split(':')[0] === '802-11-wireless.ssid') {
          ret.ssid = item.split(':')[1]
        } else if (item.split(':')[0] === '802-11-wireless.band') {
          if (item.split(':')[1] === '') {
            ret.band = 'bg'
          } else {
            ret.band = item.split(':')[1]
          }
        } else if (item.split(':')[0] === 'ipv4.method') {
          ret.DHCP = item.split(':')[1]
        }
        // static IP configured in profile
        else if (item.split(':')[0] === 'ipv4.addresses' && item.split(':').length > 1 && item.split(':')[1] !== '') {
          configuredIP = item.split(':')[1].split('/')[0]
          configuredSubnet = CIDR2netmask(item.split(':')[1].split('/')[1])
        }
        // active runtime IP
        else if (item.split(':')[0] === 'IP4.ADDRESS[1]' && item.split(':').length > 1 && item.split(':')[1] !== '') {
          activeIP = item.split(':')[1].split('/')[0]
          activeSubnet = CIDR2netmask(item.split(':')[1].split('/')[1])
        } else if (item.split(':')[0] === '802-11-wireless.mode') {
          ret.mode = item.split(':')[1]
        } else if (item.split(':')[0] === '802-11-wireless-security.key-mgmt') {
          ret.wpaType = item.split(':')[1]
        } else if (item.split(':')[0] === '802-11-wireless-security.psk') {
          ret.password = item.split(':')[1]
        } else if (item.split(':')[0] === 'connection.interface-name') {
          ret.attachedIface = item.split(':')[1]
        } else if (item.split(':')[0] === '802-11-wireless.channel') {
          ret.channel = item.split(':')[1]
        } else if (item.split(':')[0] === 'connection.autoconnect-priority') {
          ret.priority = parseInt(item.split(':')[1]) || 0
        }
      })

      if (ret.DHCP === 'auto') {
        ret.IP = activeIP || configuredIP
        ret.subnet = activeSubnet || configuredSubnet
      } else {
        ret.IP = configuredIP || activeIP
        ret.subnet = configuredSubnet || activeSubnet
      }

      return callback(null, ret)
    }
  })
}

function CIDR2netmask (bitCountstr) {
  const mask = []
  let bitCount = parseInt(bitCountstr)
  // console.log(bitCountstr);
  for (let i = 0; i < 4; i++) {
    const n = Math.min(bitCount, 8)
    // console.log(bitCount);
    mask.push(256 - Math.pow(2, 8 - n))
    bitCount -= n
  }
  return mask.join('.')
}

function netmask2CIDR (mask) {
  let cidr = ''
  for (const m of mask.split('.')) {
    if (parseInt(m) > 255) { throw 'ERROR: Invalid Netmask' } // Check each group is 0-255
    if (parseInt(m) > 0 && parseInt(m) < 128) { throw 'ERROR: Invalid Netmask' }

    cidr += (m >>> 0).toString(2)
  }
  // Condition to check for validity of the netmask
  if (cidr.substring(cidr.search('0'), 32).search('1') !== -1) {
    console.log('Error in netmask2CIDR() ', { message: mask })
    throw 'ERROR: Invalid Netmask ' + mask
  }
  return cidr.split('1').length - 1
}

function getEthernetAliases (callback) {
  let aliases = settings.value('ethernet.aliases', [])
  if (!Array.isArray(aliases)) {
    aliases = []
  }

  // Migrate old single alias if present and list is empty
  const oldEnabled = Boolean(settings.value('ethernet.alias.enabled', false))
  const oldIp = settings.value('ethernet.alias.ip', '')
  const oldSubnet = settings.value('ethernet.alias.subnet', '255.255.255.0')
  if (aliases.length === 0 && oldEnabled && oldIp) {
    aliases.push({ id: 'alias-' + Date.now(), ip: oldIp, subnet: oldSubnet })
    settings.setValue('ethernet.aliases', aliases)
  }

  execFile('ip', ['-o', '-4', 'addr', 'show', 'dev', 'eth0'], (err, stdout) => {
    const out = stdout || ''
    const result = aliases.map(item => ({
      id: item.id || (item.ip + '-' + item.subnet),
      ip: item.ip,
      subnet: item.subnet || '255.255.255.0',
      active: out.includes(` ${item.ip}/`)
    }))
    return callback(null, result)
  })
}

function setEthernetAliases (aliasesList, callback) {
  if (!Array.isArray(aliasesList)) {
    return callback(new Error('Invalid aliases list'))
  }

  const oldAliases = settings.value('ethernet.aliases', [])
  const validList = aliasesList.filter(item => item && item.ip).map((item, idx) => ({
    id: item.id || ('alias-' + idx + '-' + Date.now()),
    ip: item.ip.trim(),
    subnet: (item.subnet || '255.255.255.0').trim()
  }))

  settings.setValue('ethernet.aliases', validList)

  // Build ETH_ALIASES string for /etc/default/rpanion-eth-alias
  const aliasEntries = []
  validList.forEach(item => {
    try {
      const cidr = netmask2CIDR(item.subnet) || 24
      aliasEntries.push(`${item.ip}/${cidr}`)
    } catch (_) {}
  })

  const configContent = `ETH_ALIASES="${aliasEntries.join(' ')}"\n`
  try {
    fs.writeFileSync('/etc/default/rpanion-eth-alias', configContent)
  } catch (e) {
    try {
      fs.writeFileSync('/tmp/rpanion-eth-alias', configContent)
      execSync('sudo cp /tmp/rpanion-eth-alias /etc/default/rpanion-eth-alias && sudo chown rpanion:rpanion /etc/default/rpanion-eth-alias && rm -f /tmp/rpanion-eth-alias')
    } catch (err2) {
      console.error('Error writing /etc/default/rpanion-eth-alias: ' + err2)
    }
  }

  // Remove old IPs that are no longer in validList
  if (Array.isArray(oldAliases)) {
    oldAliases.forEach(oldItem => {
      if (!validList.some(newItem => newItem.ip === oldItem.ip)) {
        try {
          const cidr = netmask2CIDR(oldItem.subnet) || 24
          execSync(`sudo ip addr del ${oldItem.ip}/${cidr} dev eth0 2>/dev/null || true`)
        } catch (_) {}
      }
    })
  }

  // Add new IPs on eth0
  aliasEntries.forEach(entry => {
    try {
      execSync(`sudo ip addr add ${entry} dev eth0 2>/dev/null || true`)
    } catch (_) {}
  })

  return callback(null, 'OK')
}

function getEthernetAlias (callback) {
  getEthernetAliases((err, list) => {
    if (err) return callback(err)
    if (list && list.length > 0) {
      return callback(null, { enabled: true, ip: list[0].ip, subnet: list[0].subnet, active: list[0].active })
    }
    return callback(null, { enabled: false, ip: '', subnet: '255.255.255.0', active: false })
  })
}

function setEthernetAlias (aliasSettings, callback) {
  if (aliasSettings.enabled && aliasSettings.ip) {
    return setEthernetAliases([{ ip: aliasSettings.ip, subnet: aliasSettings.subnet || '255.255.255.0' }], callback)
  } else {
    return setEthernetAliases([], callback)
  }
}

function applyEthernetAlias () {
  execFile('nmcli', ['-t', '-f', 'DEVICE,STATE', 'dev'], (err, stdout) => {
    if (err || !(stdout || '').includes('eth0:connected')) {
      return;
    }
    const aliases = settings.value('ethernet.aliases', [])
    if (Array.isArray(aliases)) {
      aliases.forEach(item => {
        if (item.ip && item.subnet) {
          try {
            const cidr = netmask2CIDR(item.subnet) || 24
            execFile('sudo', ['ip', 'addr', 'add', `${item.ip}/${cidr}`, 'dev', 'eth0'], () => {})
          } catch (_) {}
        }
      })
    }
  });
}

module.exports = {
  getAdapters,
  getConnections,
  getConnectionDetails,
  activateConnection,
  deleteConnection,
  editConnection,
  addConnection,
  deactivateConnection,
  getWirelessStatus,
  setWirelessStatus,
  getWifiScan,
  getEthernetAlias,
  setEthernetAlias,
  getEthernetAliases,
  setEthernetAliases,
  applyEthernetAlias
}
