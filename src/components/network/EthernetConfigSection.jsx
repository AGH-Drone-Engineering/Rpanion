import React from 'react';
import PropTypes from 'prop-types';
import Accordion from 'react-bootstrap/Accordion';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import Button from 'react-bootstrap/Button';
import Table from 'react-bootstrap/Table';
import IPAddressInput from '../IPAddressInput.jsx';

function EthernetConfigSection({
  currentEthConn,
  isClientActive,
  isServerActive,
  onActivateProfile,
  waiting,
  ethServerSettings,
  ethServerSaving,
  onServerSettingsChange,
  onSaveServer,
  ethAliases,
  newAliasIp,
  newAliasSubnet,
  ethAliasesSaving,
  onNewAliasIpChange,
  onNewAliasSubnetChange,
  onAddAlias,
  onPromptDeleteAlias
}) {
  return (
    <Accordion className="mt-4 eth-accordion" defaultActiveKey="0">
      <Accordion.Item eventKey="0">
        <Accordion.Header>
          Edit Connection:{' '}
          <strong className="ms-1">
            {currentEthConn === 'server' && 'DHCP Server'}
            {currentEthConn === 'client' && 'DHCP Client'}
            {currentEthConn === 'static' && 'Static IP'}
          </strong>
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip id="eth-help-tooltip">
                {currentEthConn === 'server' && 'DHCP server running when no external router is connected.'}
                {currentEthConn === 'client' && 'Automatically obtains an IP address via DHCP when connected to an external router or network.'}
                {currentEthConn === 'static' && 'Assign secondary static IP addresses to ethernet interface in the background (e.g. for cameras or payload devices).'}
              </Tooltip>
            }
          >
            <span
              className="badge rounded-pill bg-light text-secondary border ms-auto"
              style={{ cursor: 'help', fontSize: '0.75rem', padding: '3px 7px' }}
              onClick={(e) => e.stopPropagation()}
            >
              ?
            </span>
          </OverlayTrigger>
        </Accordion.Header>
        <Accordion.Body>
          {currentEthConn === 'server' && (
            <div>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-4 col-form-label">Gateway IP</label>
                <div className="col-sm-8">
                  <IPAddressInput
                    name="ethServerIp"
                    value={ethServerSettings.ipaddress}
                    onChange={(e) => onServerSettingsChange('ipaddress', e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-4 col-form-label">Subnet Mask</label>
                <div className="col-sm-8">
                  <IPAddressInput
                    name="ethServerSubnet"
                    value={ethServerSettings.subnet}
                    onChange={(e) => onServerSettingsChange('subnet', e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-4 col-form-label"></label>
                <div className="col-sm-8 d-flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={onSaveServer}
                    disabled={ethServerSaving || waiting}
                  >
                    {ethServerSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                  {!isServerActive && (
                    <Button
                      size="sm"
                      variant="outline-primary"
                      onClick={() => onActivateProfile('Ethernet-Server')}
                      disabled={ethServerSaving || waiting}
                    >
                      {waiting ? 'Activating...' : 'Activate DHCP Server'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {currentEthConn === 'client' && (
            <div>
              <p className="text-muted mb-2">
                Automatically obtains an IP address via DHCP when connected to an external router or network.
              </p>
              {!isClientActive ? (
                <div className="d-flex align-items-center gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onActivateProfile('Ethernet-Client')}
                    disabled={waiting}
                  >
                    {waiting ? 'Activating...' : 'Activate DHCP Client'}
                  </Button>
                  <span className="text-muted small">
                    Attempts to request an IP address from an external DHCP server.
                  </span>
                </div>
              ) : (
                <div className="alert alert-success py-1 px-2 d-inline-block mt-2 mb-0" style={{ fontSize: '0.875rem' }}>
                  ✓ DHCP Client is currently active on ethernet interface.
                </div>
              )}
            </div>
          )}

          {currentEthConn === 'static' && (
            <div>
              {ethAliases && ethAliases.length > 0 && (
                <Table striped bordered hover size="sm" className="mb-4">
                  <thead>
                    <tr>
                      <th>IP Address</th>
                      <th>Subnet Mask</th>
                      <th>Status</th>
                      <th style={{ width: '80px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ethAliases.map((alias) => (
                      <tr key={alias.id}>
                        <td>{alias.ip}</td>
                        <td>{alias.subnet}</td>
                        <td>
                          {alias.active ? (
                            <span className="badge bg-success">Active</span>
                          ) : (
                            <span className="badge bg-secondary">Standby</span>
                          )}
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant="outline-danger"
                            onClick={() => onPromptDeleteAlias(alias)}
                            disabled={ethAliasesSaving}
                          >
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}

              <h4>Add Static IP Alias</h4>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-4 col-form-label">IP Address</label>
                <div className="col-sm-8">
                  <IPAddressInput
                    name="newAliasIp"
                    value={newAliasIp}
                    onChange={(e) => onNewAliasIpChange(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-4 col-form-label">Subnet Mask</label>
                <div className="col-sm-8">
                  <IPAddressInput
                    name="newAliasSubnet"
                    value={newAliasSubnet}
                    onChange={(e) => onNewAliasSubnetChange(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-4 col-form-label"></label>
                <div className="col-sm-8">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={onAddAlias}
                    disabled={ethAliasesSaving || !newAliasIp}
                  >
                    {ethAliasesSaving ? 'Adding...' : 'Add Static IP'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Accordion.Body>
      </Accordion.Item>
    </Accordion>
  );
}

EthernetConfigSection.propTypes = {
  currentEthConn: PropTypes.string.isRequired,
  isClientActive: PropTypes.bool.isRequired,
  isServerActive: PropTypes.bool.isRequired,
  onActivateProfile: PropTypes.func.isRequired,
  waiting: PropTypes.bool,
  ethServerSettings: PropTypes.shape({
    ipaddress: PropTypes.string,
    subnet: PropTypes.string
  }).isRequired,
  ethServerSaving: PropTypes.bool.isRequired,
  onServerSettingsChange: PropTypes.func.isRequired,
  onSaveServer: PropTypes.func.isRequired,
  ethAliases: PropTypes.array.isRequired,
  newAliasIp: PropTypes.string.isRequired,
  newAliasSubnet: PropTypes.string.isRequired,
  ethAliasesSaving: PropTypes.bool.isRequired,
  onNewAliasIpChange: PropTypes.func.isRequired,
  onNewAliasSubnetChange: PropTypes.func.isRequired,
  onAddAlias: PropTypes.func.isRequired,
  onPromptDeleteAlias: PropTypes.func.isRequired
};

export default EthernetConfigSection;
