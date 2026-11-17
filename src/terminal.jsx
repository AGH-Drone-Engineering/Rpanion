import React from 'react'

import basePage from './basePage.jsx'
import TerminalSession from './components/terminal/TerminalSession.jsx'

class terminalPage extends basePage {
  componentDidMount () {
    this.loadDone()
  }

  renderTitle () {
    return 'Terminal'
  }

  renderContent () {
    return <TerminalSession token={this.state.token} />
  }
}

export default terminalPage
