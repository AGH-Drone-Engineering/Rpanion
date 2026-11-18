import Button from 'react-bootstrap/Button';
import Table from 'react-bootstrap/Table';
import Accordion from 'react-bootstrap/Accordion';
import Modal from 'react-bootstrap/Modal';
import React from 'react'

import basePage from './basePage.jsx';

import './css/styles.css';

const IMAGE_FILE = /\.(jpe?g|png|gif)$/i;
const LOGS_CHANGED_DEBOUNCE_MS = 500;
const SECTION_TYPES = { '0': 'telemetry', '1': 'bin', '2': 'kmz', '3': 'terminal', '4': 'media' };

class LoggerPage extends basePage {
  constructor (props, useSocketIO = true) {
    super(props, useSocketIO)
    this.state = {
      ...this.state,
      TlogFiles: [],
      BinlogFiles: [],
      KMZlogFiles: [],
      MediaFiles: [],
      terminalLogFiles: [],
      terminalLogsEnabled: true,
      diskSpaceStatus: "",
      conversionLogStatus: 'N/A',
      videoStreamStatus: 'N/A',
      doLogConversion: true,
      viewerKey: null
    }
    this.pendingTypes = new Set()
    this.logsChangedTimer = null

    //Socket.io client for reading update values
    this.socket.on('LogConversionStatus', function (msg) {
      this.setState({ conversionLogStatus: msg })
    }.bind(this))
    this.socket.on('VideoStreamStatus', function (msg) {
    this.setState({ videoStreamStatus: msg })
    }.bind(this))
    this.socket.on('logs:changed', function (msg) {
      this.queueLogsRefresh(msg && msg.type)
    }.bind(this))
    this.socket.on('reconnect', function () {
      //refresh state
      this.componentDidMount()
    }.bind(this))
  }


  handleDoLogConversion = () => {
    //user clicked enable/disable log conversion
    fetch('/api/logconversion', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.token}`
        },
        body: JSON.stringify({
            doLogConversion: !this.state.doLogConversion,
        })
      }).then(response => response.json()).then(state => { this.setState(state) });
  }
  componentDidMount() {
    this.loadLogFiles().then(() => this.loadDone());
    this.loadTerminalLogs();
    fetch(`/api/diskinfo`, {headers: {Authorization: `Bearer ${this.state.token}`}}).then(response => response.json()).then(state => { this.setState(state) });
    fetch(`/api/logconversioninfo`, {headers: {Authorization: `Bearer ${this.state.token}`}}).then(response => response.json()).then(state => { this.setState(state); this.loadDone() })
  }

  loadLogFiles() {
    return fetch(`/api/logfiles`, {headers: {Authorization: `Bearer ${this.state.token}`}}).then(response => response.json()).then(state => { this.setState(state) });
  }

  queueLogsRefresh(type) {
    if (!type) return;
    this.pendingTypes.add(type);
    clearTimeout(this.logsChangedTimer);
    this.logsChangedTimer = setTimeout(this.flushLogsRefresh, LOGS_CHANGED_DEBOUNCE_MS);
  }

  flushLogsRefresh = () => {
    const types = this.pendingTypes;
    this.pendingTypes = new Set();
    this.logsChangedTimer = null;
    if ([...types].some(type => type !== 'terminal')) this.loadLogFiles();
    if (types.has('terminal')) this.loadTerminalLogs();
  }

  handleSectionSelect = (eventKey) => {
    const type = SECTION_TYPES[eventKey];
    if (!type) return;
    if (type === 'terminal') this.loadTerminalLogs();
    else this.loadLogFiles();
  }

  componentWillUnmount() {
    clearTimeout(this.logsChangedTimer);
    document.removeEventListener('keydown', this.handleViewerKey);
    super.componentWillUnmount();
  }

  componentDidUpdate(prevProps, prevState) {
    const wasOpen = prevState.viewerKey !== null;
    const isOpen = this.state.viewerKey !== null;
    if (isOpen && !wasOpen) document.addEventListener('keydown', this.handleViewerKey);
    if (!isOpen && wasOpen) document.removeEventListener('keydown', this.handleViewerKey);
    if (isOpen && this.viewerIndex() === -1) this.closeViewer();
  }

  sortedMedia() {
    return [...this.state.MediaFiles].sort((a, b) => b.mtime - a.mtime);
  }

  viewerImages() {
    return this.sortedMedia().filter(log => IMAGE_FILE.test(log.key));
  }

  viewerIndex() {
    return this.viewerImages().findIndex(log => log.key === this.state.viewerKey);
  }

  openViewer = (event, key) => {
    event.preventDefault();
    this.setState({ viewerKey: key });
  }

  closeViewer = () => {
    this.setState({ viewerKey: null });
  }

  stepViewer = (step) => {
    const images = this.viewerImages();
    const target = images[this.viewerIndex() + step];
    if (target) this.setState({ viewerKey: target.key });
  }

  handleViewerKey = (event) => {
    if (event.key === 'ArrowLeft') this.stepViewer(-1);
    else if (event.key === 'ArrowRight') this.stepViewer(1);
    else if (event.key === 'Escape') this.closeViewer();
  }

  loadTerminalLogs() {
    return fetch('/api/terminal/logs', { headers: { Authorization: `Bearer ${this.state.token}` } })
      .then(response => response.json().catch(() => ({})).then(data => {
        if (!response.ok) {
          throw new Error(data.error || response.statusText);
        }
        this.setState({ terminalLogFiles: data.files, terminalLogsEnabled: data.enabled });
      }))
      .catch(error => {
        this.setState({ error: "Error loading terminal logs: " + error.message });
      });
  }

  handleTerminalLogsEnabled = () => {
    const enabled = !this.state.terminalLogsEnabled;
    this.postTerminalLogs('/api/terminal/logs/enabled', { enabled }, 'Error changing terminal logging: ');
  }

  clearTerminalLogs = () => {
    this.postTerminalLogs('/api/terminal/logs/clear', {}, 'Error deleting terminal logs: ', (result) => {
      this.setState({ infoMessage: this.clearResultMessage(result) });
    });
  }

  postTerminalLogs(url, payload, errorPrefix, onSuccess) {
    this.setState({ waiting: true }, () => {
      fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.token}`
        },
        body: JSON.stringify(payload)
      }).then(response => response.json().catch(() => ({})).then(data => {
          if (!response.ok || data.error) {
            throw new Error(data.error || response.statusText);
          }
          return data;
        }))
        .then(result => {
          if (onSuccess) onSuccess(result);
          return this.loadTerminalLogs();
        })
        .catch(error => {
          this.setState({ error: errorPrefix + error.message });
        })
        .then(() => this.setState({ waiting: false }));
    });
  }

  // The download needs the token header, so a plain link cannot be used
  downloadTerminalLog = (event, name) => {
    event.preventDefault();
    fetch('/api/terminal/logs/' + encodeURIComponent(name), { headers: { Authorization: `Bearer ${this.state.token}` } })
      .then(response => {
        if (!response.ok) {
          return response.json().catch(() => ({})).then(data => { throw new Error(data.error || response.statusText); });
        }
        return response.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      })
      .catch(error => {
        this.setState({ error: "Error downloading terminal log: " + error.message });
      });
  }

  renderTerminalLogTableData(logfilelist) {
    return logfilelist.map((log) => {
      return (
        <tr key={log.name}>
          <td><a href="#" onClick={(event) => this.downloadTerminalLog(event, log.name)}>{log.name}</a></td>
          <td>{log.size} KB</td>
          <td>{log.modified}</td>
        </tr>
      )
    });
  }

  renderTitle() {
    return "Flight Log and Media Browser";
  }

  // create an html table from a list of logfiles
  renderLogTableData(logfilelist, folder) {
    const baseUrl = window.location.origin;
    return logfilelist.map((log) => {
      return (
        <tr key={log.key}>
          <td><a href={baseUrl + "/logdownload/" + folder + "/" + log.key} download={log.name}>{log.key}</a></td>
          <td>{log.size} KB</td>
          <td>{log.modified}</td>
        </tr>
      )
    });
  }

  // Media files, newest first
  renderMediaTableData() {
    const baseUrl = window.location.origin;
    return this.sortedMedia().map((log) => {
      const isImage = IMAGE_FILE.test(log.key);
      return (
        <tr key={log.key}>
          <td><a href={baseUrl + "/media/" + log.key} download={log.name} onClick={isImage ? (event) => this.openViewer(event, log.key) : undefined}>{log.key}</a></td>
          <td>{log.size} KB</td>
          <td>{log.modified}</td>
        </tr>
      )
    });
  }

  clearResultMessage(result) {
    const parts = [`Deleted ${result.deleted || 0} files`];
    if (result.skipped > 0) {
      parts.push(`${result.skipped} files in use were kept`);
    }
    return parts.join('. ');
  }

  clearLogs = (event) => {
    //this.setState((state) => ({ value: state.value + 1}));
    const id = event.target.id;
    this.setState({ waiting: true }, () => {
      fetch('/api/deletelogfiles', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.token}`
        },
        body: JSON.stringify({
          logtype: id,
        })
      }).then(response => response.json().catch(() => ({})).then(data => {
          if (!response.ok || data.error) {
            throw new Error(data.error || response.statusText);
          }
          return data;
        }))
        .then(result => {
          this.componentDidMount();
          this.setState({ waiting: false, infoMessage: this.clearResultMessage(result) });
        })
        .catch(error => {
          this.componentDidMount();
          this.setState({ waiting: false, error: "Error deleting logfiles: " + error.message });
        });
    });
    event.preventDefault();
  }

  renderViewer() {
    const images = this.viewerImages();
    const index = this.viewerIndex();
    const current = index >= 0 ? images[index] : null;
    return (
      <Modal show={current !== null} onHide={this.closeViewer} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>{current ? current.name : ''}</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ textAlign: 'center' }}>
          {current && <img id="mediaViewerImage" src={"/media/" + current.key} alt={current.name} style={{ maxWidth: '100%', maxHeight: '70vh' }} />}
        </Modal.Body>
        <Modal.Footer>
          <Button id="mediaViewerPrev" variant="secondary" disabled={index <= 0} onClick={() => this.stepViewer(-1)}>Previous</Button>
          <Button id="mediaViewerNext" variant="secondary" disabled={index < 0 || index >= images.length - 1} onClick={() => this.stepViewer(1)}>Next</Button>
          {current && <a id="mediaViewerDownload" className="btn btn-primary" href={"/media/" + current.key} download={current.name}>Download</a>}
        </Modal.Footer>
      </Modal>
    );
  }

  renderContent() {
    return (
      <div style={{ width: 600 }}>
        <p><i>Save and download flight logs and saved photos/videos</i></p>
        <p>Disk Space: {this.state.diskSpaceStatus}</p>
        <Accordion defaultActiveKey="0" onSelect={this.handleSectionSelect}>
          <Accordion.Item eventKey="0">
            <Accordion.Header>Telemetry Logs</Accordion.Header>
            <Accordion.Body>
              <p>Telemetry Logging can be enabled or disabled in the &quot;Flight Controller&quot; page.</p>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <div className="col-sm-8">
                <Button id='tlog' onClick={this.clearLogs}>Clear inactive logs</Button>
                </div>
              </div>
              <Table id='Tlogfile' striped bordered hover size="sm">
                <thead>
                  <tr><th>File Name</th><th>Size</th><th>Modified</th></tr>
                </thead>
                <tbody>
                  {this.renderLogTableData(this.state.TlogFiles, "telemetry")}
                </tbody>
              </Table>
            </Accordion.Body>
          </Accordion.Item>
          <Accordion.Item eventKey="1">
            <Accordion.Header>Bin Logs</Accordion.Header>
            <Accordion.Body>
              <p>This requires the <code>LOG_BACKEND_TYPE</code> parameter in ArduPilot set to <code>Mavlink</code>. A high baudrate to the flight controller (921500 or greater) is required.</p>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <div className="col-sm-8">
                <Button id='binlog' onClick={this.clearLogs}>Clear inactive logs</Button>
                </div>
              </div>
              <Table id='Binlogfile' striped bordered hover size="sm">
                <thead>
                  <tr><th>File Name</th><th>Size</th><th>Modified</th></tr>
                </thead>
                <tbody>
                  {this.renderLogTableData(this.state.BinlogFiles, "bin")}
                </tbody>
              </Table>
            </Accordion.Body>
          </Accordion.Item>
          <Accordion.Item eventKey="2">
            <Accordion.Header>KMZ Files</Accordion.Header>
            <Accordion.Body>
              <p>KMZ files created from the Telemetry Logs every 20 seconds.</p>
              
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <div className="col-sm-8">
                  <Button onClick={this.handleDoLogConversion} className="btn btn-primary">{this.state.doLogConversion === true ? 'Disable' : 'Enable'}</Button>
                </div>
              </div>
              <p>Status: {this.state.conversionLogStatus}</p>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <div className="col-sm-8">
                <Button id='kmzlog' onClick={this.clearLogs}>Clear KMZ files</Button>
                </div>
              </div>
              <Table id='KMZlogfile' striped bordered hover size="sm">
                <thead>
                  <tr><th>File Name</th><th>Size</th><th>Modified</th></tr>
                </thead>
                <tbody>
                  {this.renderLogTableData(this.state.KMZlogFiles, "kmz")}
                </tbody>
              </Table>
            </Accordion.Body>
          </Accordion.Item>
          <Accordion.Item eventKey="3">
            <Accordion.Header>Terminal Logs</Accordion.Header>
            <Accordion.Body>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <div className="col-sm-8">
                  <Button onClick={this.handleTerminalLogsEnabled} className="btn btn-primary">{this.state.terminalLogsEnabled === true ? 'Disable' : 'Enable'}</Button>
                </div>
              </div>
              <p>Status: {this.state.terminalLogsEnabled === true ? 'Enabled' : 'Disabled'}</p>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <div className="col-sm-8">
                <Button id='terminallog' onClick={this.clearTerminalLogs}>Clear inactive logs</Button>
                </div>
              </div>
              <Table id='Terminallogfile' striped bordered hover size="sm">
                <thead>
                  <tr><th>File Name</th><th>Size</th><th>Modified</th></tr>
                </thead>
                <tbody>
                  {this.renderTerminalLogTableData(this.state.terminalLogFiles)}
                </tbody>
              </Table>
            </Accordion.Body>
          </Accordion.Item>
          <Accordion.Item eventKey="4">
            <Accordion.Header>Photo and Video Files</Accordion.Header>
            <Accordion.Body>
              <p>Photos and video files recorded by Rpanion</p>
              
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <div className="col-sm-8">
                  <p>Status: {this.state.videoStreamStatus}</p>
                </div>
              </div>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <div className="form-group row" style={{ marginBottom: '5px' }}>
                <div className="col-sm-8">
                <Button id='media' onClick={this.clearLogs}>Delete all media files and subdirectories</Button>
                </div>
              </div>
              </div>
              <Table id='Mediafile' striped bordered hover size="sm">
                <thead>
                  <tr><th>File Name</th><th>Size</th><th>Modified</th></tr>
                </thead>
              </Table>

              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <Table striped bordered hover size="sm">
                  <tbody>
                    {this.renderMediaTableData()}
                  </tbody>
                </Table>
              </div>
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>
        {this.renderViewer()}
      </div>
    );
  }
}


export default LoggerPage;
