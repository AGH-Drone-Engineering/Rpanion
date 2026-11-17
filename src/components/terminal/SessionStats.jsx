import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Popover from 'react-bootstrap/Popover';
import ProgressBar from 'react-bootstrap/ProgressBar';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';

const MB = 1024 * 1024;

// CPU use of the slice in percent of one core, from two usage_usec samples
export function cpuPercent(previous, current) {
  if (!previous || !current || previous.usageUsec === null || current.usageUsec === null) return null;
  const elapsedMs = current.sampledAt - previous.sampledAt;
  if (elapsedMs <= 0) return null;
  return Math.max(0, Math.round(((current.usageUsec - previous.usageUsec) / 1000 / elapsedMs) * 100));
}

// Share of all cores, 0-100
export function cpuTotalPercent(percentOfOneCore, cores) {
  if (percentOfOneCore === null || !cores) return null;
  return Math.min(100, Math.round(percentOfOneCore / cores));
}

const KILLS_HELP = 'Programs started as pi (this terminal and SSH sessions) that the kernel stopped '
  + 'because memory ran out, since the board started. The kernel stops the process using the most '
  + 'memory; Rpanion is excluded from that choice.';

function Help({ id, text }) {
  return (
    <OverlayTrigger
      trigger={['hover', 'focus']}
      placement="right"
      overlay={<Popover id={id}><Popover.Body>{text}</Popover.Body></Popover>}
    >
      <span className="badge rounded-pill bg-secondary ms-1" role="button" tabIndex={0} aria-label="Help">?</span>
    </OverlayTrigger>
  );
}

Help.propTypes = {
  id: PropTypes.string.isRequired,
  text: PropTypes.string.isRequired
};

function SessionStats({ status }) {
  const [cpu, setCpu] = useState(null);
  const previous = useRef(null);

  useEffect(() => {
    if (!status) return;
    const sample = { usageUsec: status.cpu.usageUsec, sampledAt: status.sampledAt };
    setCpu(cpuPercent(previous.current, sample));
    previous.current = sample;
  }, [status]);

  if (!status) return null;

  const { memory } = status;
  const anonMb = memory.anonBytes === null ? null : Math.round(memory.anonBytes / MB);
  const limitBytes = memory.maxBytes ?? memory.totalBytes;
  const limitMb = limitBytes ? Math.round(limitBytes / MB) : null;
  const memPercent = anonMb !== null && limitMb ? Math.min(100, (anonMb / limitMb) * 100) : 0;
  const cpuTotal = cpuTotalPercent(cpu, status.cpu.cores);

  return (
    <div className="mb-3">
      <Row className="g-3" style={{ maxWidth: 1000 }}>
        <Col xs={12} md={6}>
          <div>
            Memory{memory.controller
              ? <span>: {anonMb} MB{limitMb !== null ? ` of ${limitMb} MB` : ''}</span>
              : <span>: unavailable</span>}
          </div>
          <ProgressBar now={memPercent} variant={memPercent > 90 ? 'danger' : undefined} aria-label="Memory" />
        </Col>
        <Col xs={12} md={6}>
          <div>CPU: {cpuTotal === null ? '-' : `${cpuTotal}%`}{status.cpu.cores ? ` of ${status.cpu.cores} cores` : ''}</div>
          <ProgressBar now={cpuTotal ?? 0} aria-label="CPU" />
        </Col>
      </Row>
      <div className="mt-2">
        Killed when out of memory: {memory.oomKills ?? 0}
        <Help id="kills-help" text={KILLS_HELP} />
      </div>
    </div>
  );
}

SessionStats.propTypes = {
  status: PropTypes.shape({
    memory: PropTypes.object.isRequired,
    cpu: PropTypes.object.isRequired,
    sampledAt: PropTypes.number
  })
};

export default SessionStats;
