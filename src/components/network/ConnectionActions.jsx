import React from 'react';
import PropTypes from 'prop-types';
import Button from 'react-bootstrap/Button';
import { isFallbackProfile, isSystemProfile } from './networkModel.js';

// Activate/Deactivate, Delete and Refresh for one profile; children are placed after Activate/Deactivate
function ConnectionActions({ connection, disabled, onActivate, onDeactivate, onDelete, onRefresh, children }) {
  const isConnected = Boolean(connection && connection.state !== '');
  const isFallback = isFallbackProfile(connection);
  const isSystem = isSystemProfile(connection);
  const isTun = Boolean(connection && connection.type === 'tun');

  return (
    <div className="form-group row" style={{ marginBottom: '15px' }}>
      <label className="col-sm-4 col-form-label">Actions</label>
      <div className="col-sm-8 d-flex flex-wrap gap-2">
        {isConnected ? (
          <Button
            size="sm"
            variant="warning"
            onClick={() => onDeactivate(connection)}
            disabled={disabled || isFallback}
            className="deactivateConnection"
            title={isFallback ? 'Fallback connection cannot be deactivated manually' : 'Deactivate'}
          >
            Deactivate
          </Button>
        ) : (
          <Button
            size="sm"
            variant="success"
            onClick={() => onActivate(connection)}
            disabled={!connection || disabled}
            className="activateConnection"
          >
            Activate
          </Button>
        )}
        {children}
        <Button
          size="sm"
          variant="outline-danger"
          onClick={() => onDelete(connection)}
          disabled={!connection || isSystem || isTun}
          className="deleteConnection"
          title={isSystem ? 'System profile cannot be deleted' : 'Delete'}
        >
          Delete
        </Button>
        <Button size="sm" variant="outline-secondary" onClick={onRefresh} disabled={isTun}>
          Refresh
        </Button>
      </div>
    </div>
  );
}

ConnectionActions.propTypes = {
  connection: PropTypes.object,
  disabled: PropTypes.bool,
  onActivate: PropTypes.func.isRequired,
  onDeactivate: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onRefresh: PropTypes.func.isRequired,
  children: PropTypes.node
};

export default ConnectionActions;
