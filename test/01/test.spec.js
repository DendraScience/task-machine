/**
 * Main tests
 */

describe('Module', function () {
  let tm

  // Simple logging to an array
  const logEntries = []
  const logger = {
    log: (...args) => {
      logEntries.push([...args].join(' '))
    }
  }

  it('should import', function () {
    tm = require('../../dist')

    expect(tm).to.have.property('TaskMachine')
    expect(tm).to.have.property('NEVER_EXECUTED')
  })

  it('should run task against model', function () {
    let afterExecuteRes

    const model = {}
    const tasks = {
      a: {
        clear (m) {
          m.value = null
        },
        guard (m) {
          return !m.value
        },
        execute (m) {
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              resolve({some: 'data'})
            }, 200)
          })
        },
        afterExecute (m, res) {
          afterExecuteRes = res
          return res
        },
        assign (m, res) {
          m.value = res
        }
      }
    }

    tm.configure({
      interval: 200,
      logger: logger
    })

    const machine = new tm.TaskMachine(model, tasks)

    expect(machine).to.have.property('interval', 200)

    return machine.clear().start().then(() => {
      expect(model).to.deep.include({
        aError: null,
        aRunning: false,
        aReady: true,
        machineRunning: false,
        value: {
          some: 'data'
        }
      })
      expect(afterExecuteRes).to.deep.equal({
        some: 'data'
      })
      expect(logEntries).to.have.lengthOf(6)
    })
  })
})
