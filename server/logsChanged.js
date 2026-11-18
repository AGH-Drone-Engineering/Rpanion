// Forwards 'logschanged' events (argument: telemetry|bin|kmz|terminal|media) to socket.io clients
function forwardLogsChanged (io, emitters) {
  const forward = (type) => {
    try {
      io.sockets.emit('logs:changed', { type })
    } catch (e) {
      console.error('Failed to emit logs:changed:', e)
    }
  }
  emitters.forEach((emitter) => emitter.on('logschanged', forward))
}

module.exports = { forwardLogsChanged }
