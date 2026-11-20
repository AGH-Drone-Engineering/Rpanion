import React from 'react'
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';

import basePage from './basePage.jsx'
import Sparkline from './components/Sparkline.jsx'
import './css/styles.css';

const GB = 1024 * 1024 * 1024
// Pi 5 starts throttling the CPU at 85 C
const TEMP_LIMITS = { warn: 70, danger: 80 }
const USAGE_LIMITS = { warn: 80, danger: 90 }

function levelColor (value, limits) {
  if (value === null || value === undefined) return 'var(--bs-secondary-color)'
  if (value >= limits.danger) return 'var(--bs-danger)'
  if (value >= limits.warn) return 'var(--bs-warning)'
  return 'var(--bs-primary)'
}

// Temperature axis rounded to 5 C, at least 10 C tall
function tempScale (values) {
  const r = minMax(values) || { min: 40, max: 50 }
  let lo = Math.floor(r.min / 5) * 5
  let hi = Math.ceil(r.max / 5) * 5
  if (hi - lo < 10) {
    lo = Math.floor((r.min + r.max) / 2 / 5) * 5 - 5
    hi = lo + 10
  }
  const tickStep = hi - lo > 20 ? 10 : 5
  const ticks = []
  for (let t = lo; t <= hi; t += tickStep) ticks.push(t)
  return { yMin: lo, yMax: hi, yTicks: ticks }
}

const PERCENT_SCALE = { yMin: 0, yMax: 100, yTicks: [0, 25, 50, 75, 100] }

function minMax (values) {
  const finite = values.filter(v => v !== null && Number.isFinite(v))
  if (finite.length === 0) return null
  return { min: Math.min(...finite), max: Math.max(...finite) }
}

class AboutPage extends basePage {
  constructor (props, useSocketIO = true) {
    super(props, useSocketIO)
    this.state = {
      ...this.state,
      OSVersion: '',
      Nodejsversion: '',
      rpanionversion: '',
      CPUName: '',
      RAMName: '',
      SYSName: '',
      HATName: {},
      diskSpaceStatus: '',
      powerAction: null,
      showModalResult: "",
      showResetModal: false,
      resetMessage: "",
      statsCapacity: 150,
      statsIntervalMs: 2000,
      statsSamples: [],
      statsLatest: null
    }

  }

  componentDidMount () {
    fetch('/api/softwareinfo', {headers: {Authorization: `Bearer ${this.state.token}`}}).then(response => response.json()).then(state => this.setState(state))
    fetch('/api/diskinfo', {headers: {Authorization: `Bearer ${this.state.token}`}}).then(response => response.json()).then(state => this.setState(state))
    fetch('/api/hardwareinfo', {headers: {Authorization: `Bearer ${this.state.token}`}}).then(response => response.json()).then(state => { this.setState(state); this.loadDone() })
    fetch('/api/systemstats', {headers: {Authorization: `Bearer ${this.state.token}`}})
      .then(response => response.json())
      .then(data => this.setState(prev => ({
        statsCapacity: data.capacity,
        statsIntervalMs: data.intervalMs,
        // keep samples received over socket.io before the fetch completed
        statsSamples: [...data.samples, ...prev.statsSamples.filter(s => s.t > (data.samples.at(-1)?.t ?? 0))].slice(-data.capacity),
        statsLatest: prev.statsLatest ?? data.latest
      })))
      .catch(err => console.log('Error fetching /api/systemstats', err))

    if (this.socket) {
      this.socket.on('SystemStats', this.handleSystemStats)
      // re-join the room after every (re)connect
      this.socket.on('connect', () => this.socket.emit('subscribeSystemStats'))
      if (this.socket.connected) this.socket.emit('subscribeSystemStats')
    }
  }

  handleSystemStats = (sample) => {
    this.setState(prev => ({
      statsSamples: [...prev.statsSamples, sample].slice(-prev.statsCapacity),
      statsLatest: sample
    }))
  }

  timeTicks () {
    const perMinute = Math.round(60000 / this.state.statsIntervalMs)
    const minutes = Math.round(this.state.statsCapacity / perMinute)
    const ticks = []
    for (let m = minutes; m >= 0; m--) {
      ticks.push({ back: m * perMinute, label: m === 0 ? 'now' : `-${m}m` })
    }
    return ticks
  }

  renderStatCard (title, values, value, details, limits, chart) {
    const color = levelColor(value, limits)
    return (
      <Col xs={12} sm={4} className="mb-3">
        <Card className="h-100">
          <Card.Body className="p-2">
            <div className="text-body-secondary small">{title}</div>
            <div className="fs-4 fw-semibold" style={{ color }}>{value === null || value === undefined ? 'n/a' : chart.format(value)}</div>
            <Sparkline values={values} capacity={this.state.statsCapacity} color={color} label={title + ' history'}
              {...chart.scale} formatY={chart.formatY} xTicks={this.timeTicks()} />
            <div className="text-body-secondary small">{details}</div>
          </Card.Body>
        </Card>
      </Col>
    )
  }

  renderSystemMonitor () {
    const samples = this.state.statsSamples
    const latest = this.state.statsLatest || {}
    const series = (key) => samples.map(s => s[key])
    const rangeText = (values, unit) => {
      const r = minMax(values)
      return r ? `min ${r.min.toFixed(1)}${unit} · max ${r.max.toFixed(1)}${unit}` : ''
    }
    const usage = (used, total) => (used !== null && used !== undefined && total)
      ? `${(used / GB).toFixed(1)} / ${(total / GB).toFixed(1)} GB` : ''

    const cpu = series('cpuTemp')
    const ram = series('ramPercent')
    const disk = series('diskPercent')
    const temp = { format: v => v.toFixed(1) + ' °C', formatY: v => v + '°', scale: tempScale(cpu) }
    const pct = { format: v => v.toFixed(0) + ' %', formatY: v => v + '%', scale: PERCENT_SCALE }

    return (
      <Row>
        {this.renderStatCard('CPU temperature', cpu, latest.cpuTemp, rangeText(cpu, '°'), TEMP_LIMITS, temp)}
        {this.renderStatCard('RAM used', ram, latest.ramPercent, usage(latest.ramUsed, latest.ramTotal), USAGE_LIMITS, pct)}
        {this.renderStatCard('Disk used (/)', disk, latest.diskPercent, usage(latest.diskUsed, latest.diskTotal), USAGE_LIMITS, pct)}
      </Row>
    )
  }

  confirmPowerAction = (action) => {
    this.setState({ powerAction: action });
  }

  handleClosePowerModal = () => {
    this.setState({ powerAction: null });
  }

  handlePowerAction = () => {
    const action = this.state.powerAction;
    this.setState({ powerAction: null });
    fetch(action === 'reboot' ? '/api/rebootcc' : '/api/shutdowncc', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      }
    });
  }

  confirmResetSettings = () => {
    // user clicked the reset settings button
    this.setState({ showResetModal: true });
  }

  handleCloseResetModal = () => {
    // user does not want to reset settings
    this.setState({ showResetModal: false, resetMessage: "" });
  }

  handleResetSettings = () => {
    // user does want to reset settings
    fetch('/api/resetsettings', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        this.setState({ 
          resetMessage: data.message,
          showResetModal: false 
        });
        // Show success message for a few seconds
        setTimeout(() => {
          this.setState({ resetMessage: "" });
        }, 5000);
      } else {
        this.setState({ 
          resetMessage: data.error || 'Failed to reset settings',
          showResetModal: false 
        });
      }
    })
    .catch(error => {
      this.setState({ 
        resetMessage: 'Error resetting settings: ' + error.message,
        showResetModal: false 
      });
    });
  }

  getlogs = () => {
    // download the logs
    fetch('/api/logfile', {
      method: 'GET',
      headers: {
      'Authorization': `Bearer ${this.state.token}`
      }
    })
    .then(response => response.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'rpanion.log';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    });
  }

  renderTitle () {
    return 'About'
  }

  HATInfo() {
      if (this.state.HATName.product !== "") {
        return <p>Attached HAT: {this.state.HATName.product}, Vendor: {this.state.HATName.vendor}, Version: {this.state.HATName.version}</p>;
      }
      return <p></p>;
    }

  renderContent () {
    return (
      <div>
        <h2>System Monitor</h2>
        {this.renderSystemMonitor()}
        <h2>About Hardware</h2>
        <p>System: {this.state.SYSName}</p>
        <p>CPU: {this.state.CPUName}</p>
        <p>RAM: {this.state.RAMName} GB</p>
        <p>Disk Space: {this.state.diskSpaceStatus}</p>
        {this.HATInfo()}
        <h2>About Software</h2>
        <p>OS hostname: {this.state.hostname}</p>
        <p>OS version: {this.state.OSVersion}</p>
        <p>Node.js version: {this.state.Nodejsversion}</p>
        <p>Rpanion-server version: {this.state.rpanionversion}</p>
        <h2>Logs</h2>
        <p><Button size="sm" onClick={this.getlogs}>Download Logs</Button></p>
        <h2>Controls</h2>
        <p>
          <Button size="sm" onClick={() => this.confirmPowerAction('shutdown')}>Shutdown Companion Computer</Button>{' '}
          <Button size="sm" onClick={() => this.confirmPowerAction('reboot')}>Reboot Companion Computer</Button>
        </p>
        <p><Button size="sm" variant="warning" onClick={this.confirmResetSettings}>Reset All Settings</Button></p>
        {this.state.resetMessage && (
          <div className="alert alert-info" role="alert">
            {this.state.resetMessage}
          </div>
        )}

        <Modal show={this.state.powerAction !== null} onHide={this.handleClosePowerModal}>
          <Modal.Header closeButton>
            <Modal.Title>{this.state.powerAction === 'reboot' ? 'Confirm Reboot' : 'Confirm Shutdown'}</Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <p>Are you sure you want to {this.state.powerAction === 'reboot' ? 'reboot' : 'shutdown'} the Companion Computer?</p>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="secondary" onClick={this.handlePowerAction}>Yes</Button>
            <Button variant="primary" onClick={this.handleClosePowerModal}>No</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={this.state.showResetModal} onHide={this.handleCloseResetModal}>
          <Modal.Header closeButton>
            <Modal.Title>Confirm Reset Settings</Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <p>Are you sure you want to reset all settings to defaults?</p>
            <p className="text-warning">This will clear all configuration including:</p>
            <ul>
              <li>Flight controller settings</li>
              <li>Video stream settings</li>
              <li>PPP settings</li>
              <li>NTRIP settings</li>
            </ul>
            <p className="text-danger"><strong>You will need to restart the application for changes to take effect.</strong></p>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="danger" onClick={this.handleResetSettings}>Yes, Reset All Settings</Button>
            <Button variant="primary" onClick={this.handleCloseResetModal}>Cancel</Button>
          </Modal.Footer>
        </Modal>

      </div>
    )
  }
}

export default AboutPage
