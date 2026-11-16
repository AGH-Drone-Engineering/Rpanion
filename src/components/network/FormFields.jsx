import React from 'react';
import PropTypes from 'prop-types';
import Form from 'react-bootstrap/Form';
import { isPasswordLengthValid } from './networkModel.js';

export function FormRow({ label, htmlFor, labelId, marginBottom = '5px', children }) {
  return (
    <div className="form-group row" style={{ marginBottom }}>
      <label className="col-sm-4 col-form-label" htmlFor={htmlFor} id={labelId}>{label}</label>
      <div className="col-sm-8">{children}</div>
    </div>
  );
}

FormRow.propTypes = {
  label: PropTypes.node,
  htmlFor: PropTypes.string,
  labelId: PropTypes.string,
  marginBottom: PropTypes.string,
  children: PropTypes.node
};

export function PasswordField({ id, name = 'password', value, onChange, show, onToggleShow, disabled = false, placeholder }) {
  return (
    <>
      <Form.Control
        id={id}
        name={name}
        type={show ? 'text' : 'password'}
        disabled={disabled}
        value={disabled ? '' : (value || '')}
        onChange={onChange}
        placeholder={placeholder}
        isInvalid={!disabled && !isPasswordLengthValid(value)}
      />
      <Form.Control.Feedback type="invalid">
        Password must be between 8 and 63 characters long.
      </Form.Control.Feedback>
      <Form.Check
        type="checkbox"
        id={`${id}-show`}
        label="Show Password"
        checked={show}
        disabled={disabled}
        onChange={(e) => onToggleShow(e.target.checked)}
        className="mt-2"
      />
    </>
  );
}

PasswordField.propTypes = {
  id: PropTypes.string.isRequired,
  name: PropTypes.string,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  show: PropTypes.bool.isRequired,
  onToggleShow: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  placeholder: PropTypes.string
};

const IP_TYPES = [
  { value: 'auto', label: 'DHCP Client' },
  { value: 'manual', label: 'Static IP' },
  { value: 'shared', label: 'DHCP Server' }
];

// disabled: { auto, manual, shared } booleans
export function IpTypeRadios({ idPrefix, value, onChange, disabled = {} }) {
  return (
    <div role="radiogroup" aria-labelledby={`${idPrefix}-label`}>
      {IP_TYPES.map(opt => (
        <Form.Check
          key={opt.value}
          type="radio"
          id={`${idPrefix}-${opt.value}`}
          name="ipaddresstype"
          value={opt.value}
          label={opt.label}
          checked={value === opt.value}
          onChange={onChange}
          disabled={Boolean(disabled[opt.value])}
        />
      ))}
    </div>
  );
}

IpTypeRadios.propTypes = {
  idPrefix: PropTypes.string.isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.shape({
    auto: PropTypes.bool,
    manual: PropTypes.bool,
    shared: PropTypes.bool
  })
};
