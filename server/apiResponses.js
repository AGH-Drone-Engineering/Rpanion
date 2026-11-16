function sendApiError (res, statusCode, err, payload = {}) {
  const message = typeof err === 'string' ? err : (err?.message || 'Internal server error')
  return res.status(statusCode).json({ ...payload, error: message, message })
}

function sendValidationError (res, errors) {
  const message = errors.array().map(e => e.msg && e.msg !== 'Invalid value' ? e.msg : `${e.path || e.param || 'field'}: invalid value`).join(', ')
  return res.status(422).json({ error: message, message })
}

module.exports = { sendApiError, sendValidationError }
