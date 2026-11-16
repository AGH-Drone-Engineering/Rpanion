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
                {currentEthConn === 'static' && 'Assign secondary static IP addresses to eth0 in the background (e.g. for cameras or payload devices).'}
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
                <div className="col-sm-8">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={onSaveServer}
                    disabled={ethServerSaving}
                  >
                    {ethServerSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {currentEthConn === 'client' && (
            <div>
              <p className="text-muted mb-0">Nothing to configure</p>
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
