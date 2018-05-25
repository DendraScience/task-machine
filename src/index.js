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
    ['error', 'info', 'warn'].forEach(k => { logger[k] = (options.logger && options.logger[k]) || noLog })
  }
}

// Initial configuration
configure({
  logger: false
})

export class Task {
  constructor (props) {
    Object.assign(this, props)
  }

  get isRunning () { return this.model[this.propKeys.running] }

  set isRunning (newIsRunning) {
    const {model, propKeys} = this

    if (model) {
      model[propKeys.running] = newIsRunning
    }
  }

  get isRunnable () {
    const {model, hooks} = this

    if (this.isRunning) return false // Already running task?

    // Evaluate guard condition
    return typeof hooks.guard === 'function' ? !!hooks.guard(model) : true
  }

  /**
   * Clear model state for this task.
   */
  clear () {
    const {id, key, model, hooks, propKeys} = this

    logger.info('Task #clear', {id, key})

    this.isRunning = false

    model[propKeys.error] = null
    model[propKeys.ready] = false
    model[propKeys.executedAt] = NEVER_EXECUTED

    // Invoke clear hook
    if (typeof hooks.clear === 'function') hooks.clear(model)
  }

  /**
   * Cancel processing immediately and clean up.
   */
  destroy () {
    this.destroyed = true
    this.model = null
    this.hooks = null
    this.propKeys = null
  }

  /**
   * Begin processing this task.
   */
  async start () {
    const {id, key, model, hooks, options, propKeys} = this
    const {helpers} = options

    logger.info('Task #start', {id, key})

    this.isRunning = true

    model[propKeys.error] = null
    model[propKeys.ready] = false

    try {
      if (typeof hooks.beforeExecute === 'function') hooks.beforeExecute(model, helpers)
      if (typeof hooks.execute !== 'function') throw Error('Execute not a function')

      const time = model[propKeys.executedAt] = Date.now()

      logger.info('Task #start, execute', {id, key})

      let res = await hooks.execute(model, helpers)

      // Abort if destroyed or preempted
      if (this.destroyed || !(model[propKeys.executedAt] === time)) return

      // Process results
      if (typeof hooks.afterExecute === 'function') res = hooks.afterExecute(model, res, helpers)
      if (!res) throw Error('Result not truthy')

      // Assign targets in model
      if (typeof hooks.assign === 'function') hooks.assign(model, res, helpers)

      model[propKeys.ready] = true

      logger.info('Task #start, ready', {id, key})

      this.isRunning = false
    } catch (err) {
      // Abort if destroyed
      if (this.destroyed) return

      logger.error('Task #start, error', {err, id, key})

      model[propKeys.error] = this.options.errorAsObject ? err : err.message

      this.isRunning = false
    }
  }
}

export class TaskMachine {
  constructor (model, tasks, options) {
    this.id = nextId++

    const opts = this.options = Object.assign({
      errorAsObject: false,
      interval: defaultInterval,
      machinePropKeys: defaultMachinePropKeys,
      maxExecutions: defaultMaxExecutions,
      taskPropKeys: defaultTaskPropKeys,
      waitForCompletion: false
    }, options)

    this.interval = opts.interval
    this.maxExecutions = opts.maxExecutions // Approximate upper limit
    this.model = model
    this.propKeys = opts.machinePropKeys(this)
    this.tasks = Object.keys(tasks).map(key => new Task({
      hooks: tasks[key],
      id: this.id,
      key,
      model,
      options: opts,
      propKeys: opts.taskPropKeys(this, key)
    }))

    model[this.propKeys.running] = false
    model[this.propKeys.stoppedAt] = model[this.propKeys.startedAt] = NEVER_EXECUTED
  }

  /**
   * Clear state for all tasks where the specified predicate is true.
   */
  clear (pred = true) {
    const {id} = this

    logger.info('TaskMachine #clear', {id})

    const predFn = typeof pred === 'function' ? pred : function (task) {
      return (pred === true) || (task.key === pred)
    }

    this.tasks.filter(predFn).forEach(task => task.clear())

    return this
  }

  /**
   * Cancel processing immediately and clean up.
   */
  destroy () {
    const {id} = this

    logger.info('TaskMachine #destroy', {id})

    this.destroyed = true
    this.tasks.forEach(task => task.destroy())
    this.tasks = null
    this.model = null
    this.options = null
  }

  get isRunning () { return this.model[this.propKeys.running] }

  set isRunning (newIsRunning) {
    const {id, model, propKeys} = this

    if (model) {
      model[propKeys.running] = newIsRunning
      model[newIsRunning ? propKeys.startedAt : propKeys.stoppedAt] = Date.now()
    }

    logger.info('TaskMachine #isRunning(set)', {id, newIsRunning})
  }

  /**
   * Begin processing all tasks.
   */
  async start () {
    const {id, options, tasks} = this

    logger.info('TaskMachine #start', {id})

    if (this.isRunning || this.destroyed) return false

    this.isRunning = true

    let count = 0
    let total = 0

    do {
      const runnableTasks = tasks.filter(task => task.isRunnable)

      logger.info('TaskMachine #start, runnable tasks', {
        id,
        keys: runnableTasks.map(task => task.key)
      })

      if ((runnableTasks.length === 0) && (count === 0)) break

      if (total > this.maxExecutions) {
        logger.warn('TaskMachine #start, max executions exceeded', {
          id,
          total,
          maxExecutions: this.maxExecutions})

        break
      }

      const pendingTasks = runnableTasks.map(task => {
        count++
        total++

        return task.start().then(() => (count--), () => (count--))
      })

      if (options.waitForCompletion) await Promise.all(pendingTasks)

      await new Promise(resolve => this.interval < 0 ? setImmediate(resolve) : setTimeout(resolve, this.interval))
    } while (!this.destroyed)

    this.isRunning = false

    return true
  }
}
