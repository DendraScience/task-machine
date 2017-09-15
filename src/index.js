/**
 * Utility class to execute async tasks against model state.
 *
 * @author J. Scott Smith
 * @license BSD-2-Clause-FreeBSD
 * @module task-machine
 */

export const NEVER_EXECUTED = 8640000000000000

let defaultInterval = 500
let defaultMaxExecutions = 200
let nextId = 1 // Next identifier for each TaskMachine instance

/**
 * Get model property keys for a given machine.
 */
let defaultMachinePropKeys = (machine) => {
  return {
    running: 'machineRunning',
    startedAt: 'machineStartedAt',
    stoppedAt: 'machineStoppedAt'
  }
}

/**
 * Get model property keys for a given taskKey.
 */
let defaultTaskPropKeys = (machine, taskKey) => {
  return {
    error: `${taskKey}Error`,
    executedAt: `${taskKey}ExecutedAt`,
    running: `${taskKey}Running`,
    ready: `${taskKey}Ready`
  }
}

// Local logger that can be redirected
const logger = {}

function noLog () {}

export function configure (options) {
  if (typeof options !== 'object') return
  if (typeof options.interval === 'number') defaultInterval = options.interval
  if (typeof options.maxExecutions === 'number') defaultMaxExecutions = options.maxExecutions
  if (typeof options.machinePropKeys === 'function') defaultMachinePropKeys = options.machinePropKeys
  if (typeof options.taskPropKeys === 'function') defaultTaskPropKeys = options.taskPropKeys
  if (typeof options.logger === 'object' || options.logger === false) {
    ['error', 'log', 'time', 'timeEnd', 'warn'].forEach(k => { logger[k] = (options.logger && options.logger[k]) || noLog })
  }
}

// Initial configuration
configure({
  logger: false
})

class TaskContext {
  constructor (model, keys) {
    this.time = Date.now()
    this.keys = keys
    this.model = model
  }

  execute (task) {
    this.model[this.keys.executedAt] = this.time

    return Promise.resolve(task.execute(this.model)).then(res => {
      if (this.model[this.keys.executedAt] === this.time) {
        return {
          preempted: false,
          result: res
        }
      }

      return {
        preempted: true
      }
    })
  }
}

export class TaskMachine {
  constructor (model, tasks, options) {
    this.id = nextId++
    this.options = Object.assign({
      interval: defaultInterval,
      maxExecutions: defaultMaxExecutions,
      machinePropKeys: defaultMachinePropKeys,
      taskPropKeys: defaultTaskPropKeys
    }, options)
    this.interval = this.options.interval
    this.maxExecutions = this.options.maxExecutions // Approximate upper limit
    this.model = model
    this.propKeys = this.options.machinePropKeys(this)
    this.tasks = tasks

    model[this.propKeys.running] = false
    model[this.propKeys.stoppedAt] = model[this.propKeys.startedAt] = NEVER_EXECUTED
  }

  /**
   * Clear state for all tasks where the specified predicate is true.
   */
  clear (pred = true) {
    const predFn = typeof pred === 'function' ? pred : function (taskKey) {
      return (pred === true) || (taskKey === pred)
    }
    const tasks = this.tasks
    const model = this.model

    Object.keys(tasks).filter(predFn).forEach(taskKey => {
      const keys = this.options.taskPropKeys(this, taskKey)
      const task = tasks[taskKey]

      logger.log(`TaskMachine(${this.id})#clear::taskKey`, taskKey)

      model[keys.error] = null
      model[keys.running] = false
      model[keys.ready] = false
      model[keys.executedAt] = NEVER_EXECUTED

      // Invoke clear hook
      if (typeof task.clear === 'function') task.clear(model)
    })

    return this
  }

  /**
   * Cancel processing immediately and clean up.
   */
  destroy () {
    logger.log(`TaskMachine(${this.id})#destroy`)

    this.destroyed = true
    this.tasks = null
    this.model = null
  }

  get isRunning () { return this.model[this.propKeys.running] }
  set isRunning (newIsRunning) {
    if (this.model) {
      this.model[this.propKeys.running] = newIsRunning
      this.model[newIsRunning ? this.propKeys.startedAt : this.propKeys.stoppedAt] = Date.now()
    }

    if (newIsRunning) logger.time(`TaskMachine(${this.id}).run`)
    else logger.timeEnd(`TaskMachine(${this.id}).run`)
  }

  * _workerGen (done) {
    this.isRunning = true

    logger.log(`TaskMachine(${this.id})#worker`)

    const tasks = this.tasks
    const model = this.model

    let count = 0
    let total = 0

    do {
      // Don't block, strive for async
      yield this.interval < 0 ? setImmediate(() => {
        this._worker.next()
      }) : setTimeout(() => {
        this._worker.next()
      }, this.interval)

      Object.keys(tasks).filter(taskKey => {
        const keys = this.options.taskPropKeys(this, taskKey)
        const task = tasks[taskKey]

        if (model[keys.running]) return false // Already running task?

        // Evaluate guard condition
        return typeof task.guard === 'function' ? !!task.guard(model) : true
      }).map(taskKey => {
        const keys = this.options.taskPropKeys(this, taskKey)
        const task = tasks[taskKey]

        count++
        total++

        logger.log(`TaskMachine(${this.id})#worker:beforeExecute::taskKey,count,total`, taskKey, count, total)

        model[keys.error] = null
        model[keys.running] = true
        model[keys.ready] = false

        // Optional beforeExecute hook
        if (typeof task.beforeExecute === 'function') task.beforeExecute(model)

        return (new TaskContext(model, keys)).execute(task).then(state => {
          logger.log(`TaskMachine(${this.id})#worker:afterExecute::taskKey,state`, taskKey, state)

          model[keys.running] = false

          if (this.destroyed || !state || state.preempted) return

          // Process results
          let res = state.result
          if (typeof task.afterExecute === 'function') res = task.afterExecute(model, res)
          if (!res) throw Error(`Not found: ${taskKey}`)

          // Assign targets
          if (typeof task.assign === 'function') task.assign(model, res)

          model[keys.ready] = true
        }).catch(err => {
          logger.error(`TaskMachine(${this.id})#worker:catch::taskKey,err`, taskKey, err)

          if (this.destroyed) return

          model[keys.running] = false
          model[keys.error] = err.message
        }).then(() => {
          count--
        })
      })

      // Safety net
      if (total > this.maxExecutions) {
        logger.warn(`TaskMachine(${this.id})#worker:break::total,maxExecutions`, total, this.maxExecutions)
        break
      }
    } while (count > 0 && !this.destroyed)

    logger.log(`TaskMachine(${this.id})#worker:done::total`, total)

    this.isRunning = false
    done(true)
  }

  /**
   * Begin processing all tasks. Uses a generator to manage the tasks.
   */
  start () {
    logger.log(`TaskMachine(${this.id})#start`)

    return new Promise((resolve) => {
      if (this.isRunning || this.destroyed) {
        resolve(false)
      } else {
        this._worker = this._workerGen(resolve)
        this._worker.next()
      }
    })
  }
}
