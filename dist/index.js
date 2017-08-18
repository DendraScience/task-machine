'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TaskMachine = exports.NEVER_EXECUTED = undefined;

var _regenerator = require('babel-runtime/regenerator');

var _regenerator2 = _interopRequireDefault(_regenerator);

var _setImmediate2 = require('babel-runtime/core-js/set-immediate');

var _setImmediate3 = _interopRequireDefault(_setImmediate2);

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _assign = require('babel-runtime/core-js/object/assign');

var _assign2 = _interopRequireDefault(_assign);

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _classCallCheck2 = require('babel-runtime/helpers/classCallCheck');

var _classCallCheck3 = _interopRequireDefault(_classCallCheck2);

var _createClass2 = require('babel-runtime/helpers/createClass');

var _createClass3 = _interopRequireDefault(_createClass2);

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

exports.configure = configure;

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Utility class to execute async tasks against model state.
 *
 * @author J. Scott Smith
 * @license BSD-2-Clause-FreeBSD
 * @module task-machine
 */

var NEVER_EXECUTED = exports.NEVER_EXECUTED = 8640000000000000;

var defaultInterval = 500;
var defaultMaxExecutions = 200;
var nextId = 1; // Next identifier for each TaskMachine instance

/**
 * Get model property keys for a given machine.
 */
var machinePropKeys = function machinePropKeys(machine) {
  return {
    running: 'machineRunning'
  };
};

/**
 * Get model property keys for a given taskKey.
 */
var taskPropKeys = function taskPropKeys(machine, taskKey) {
  return {
    error: taskKey + 'Error',
    executedAt: taskKey + 'ExecutedAt',
    running: taskKey + 'Running',
    ready: taskKey + 'Ready'
  };
};

// Local logger that can be redirected
var logger = {};

function noLog() {}

function configure(options) {
  if ((typeof options === 'undefined' ? 'undefined' : (0, _typeof3.default)(options)) !== 'object') return;
  if (typeof options.interval === 'number') defaultInterval = options.interval;
  if (typeof options.maxExecutions === 'number') defaultMaxExecutions = options.maxExecutions;
  if (typeof options.machinePropKeys === 'function') machinePropKeys = options.machinePropKeys;
  if (typeof options.taskPropKeys === 'function') taskPropKeys = options.taskPropKeys;
  if ((0, _typeof3.default)(options.logger) === 'object' || options.logger === false) {
    ['error', 'log', 'time', 'timeEnd', 'warn'].forEach(function (k) {
      logger[k] = options.logger && options.logger[k] || noLog;
    });
  }
}

// Initial configuration
configure({
  logger: false
});

var TaskContext = function () {
  function TaskContext(model, keys) {
    (0, _classCallCheck3.default)(this, TaskContext);

    this.time = new Date().getTime();
    this.keys = keys;
    this.model = model;
  }

  (0, _createClass3.default)(TaskContext, [{
    key: 'execute',
    value: function execute(task) {
      var _this = this;

      this.model[this.keys.executedAt] = this.time;

      return _promise2.default.resolve(task.execute(this.model)).then(function (res) {
        if (_this.model[_this.keys.executedAt] === _this.time) {
          return {
            preempted: false,
            result: res
          };
        }

        return {
          preempted: true
        };
      });
    }
  }]);
  return TaskContext;
}();

var TaskMachine = exports.TaskMachine = function () {
  function TaskMachine(model, tasks, options) {
    (0, _classCallCheck3.default)(this, TaskMachine);

    this.id = nextId++;
    this.options = (0, _assign2.default)({
      interval: defaultInterval,
      maxExecutions: defaultMaxExecutions
    }, options);
    this.interval = this.options.interval;
    this.maxExecutions = this.options.maxExecutions; // Approximate upper limit
    this.model = model;
    this.propKeys = machinePropKeys(this);
    this.tasks = tasks;

    model[this.propKeys.running] = false;
  }

  /**
   * Clear state for all tasks where the specified predicate is true.
   */


  (0, _createClass3.default)(TaskMachine, [{
    key: 'clear',
    value: function clear() {
      var _this2 = this;

      var pred = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;

      var predFn = typeof pred === 'function' ? pred : function (taskKey) {
        return pred === true || taskKey === pred;
      };
      var tasks = this.tasks;
      var model = this.model;

      (0, _keys2.default)(tasks).filter(predFn).forEach(function (taskKey) {
        var keys = taskPropKeys(_this2, taskKey);
        var task = tasks[taskKey];

        logger.log('TaskMachine(' + _this2.id + ')#clear::taskKey', taskKey);

        model[keys.error] = null;
        model[keys.running] = false;
        model[keys.ready] = false;
        model[keys.executedAt] = NEVER_EXECUTED;

        // Invoke clear hook
        if (typeof task.clear === 'function') task.clear(model);
      });

      return this;
    }

    /**
     * Cancel processing immediately and clean up.
     */

  }, {
    key: 'destroy',
    value: function destroy() {
      logger.log('TaskMachine(' + this.id + ')#destroy');

      this.destroyed = true;
      this.tasks = null;
      this.model = null;
    }
  }, {
    key: '_workerGen',
    value: /*#__PURE__*/_regenerator2.default.mark(function _workerGen(done) {
      var _this3 = this;

      var tasks, model, count, total;
      return _regenerator2.default.wrap(function _workerGen$(_context) {
        while (1) {
          switch (_context.prev = _context.next) {
            case 0:
              this.isRunning = true;

              logger.log('TaskMachine(' + this.id + ')#worker');

              tasks = this.tasks;
              model = this.model;
              count = 0;
              total = 0;

            case 6:
              _context.next = 8;
              return this.interval < 0 ? (0, _setImmediate3.default)(function () {
                _this3._worker.next();
              }) : setTimeout(function () {
                _this3._worker.next();
              }, this.interval);

            case 8:

              (0, _keys2.default)(tasks).filter(function (taskKey) {
                var keys = taskPropKeys(_this3, taskKey);
                var task = tasks[taskKey];

                if (model[keys.running]) return false; // Already running task?

                // Evaluate guard condition
                return typeof task.guard === 'function' ? !!task.guard(model) : true;
              }).map(function (taskKey) {
                var keys = taskPropKeys(_this3, taskKey);
                var task = tasks[taskKey];

                count++;
                total++;

                logger.log('TaskMachine(' + _this3.id + ')#worker:beforeExecute::taskKey,count,total', taskKey, count, total);

                model[keys.error] = null;
                model[keys.running] = true;
                model[keys.ready] = false;

                // Optional beforeExecute hook
                if (typeof task.beforeExecute === 'function') task.beforeExecute(model);

                return new TaskContext(model, keys).execute(task).then(function (state) {
                  logger.log('TaskMachine(' + _this3.id + ')#worker:afterExecute::taskKey,state', taskKey, state);

                  model[keys.running] = false;

                  if (_this3.destroyed || !state || state.preempted) return;

                  // Process results
                  var res = state.result;
                  if (typeof task.afterExecute === 'function') res = task.afterExecute(model, res);
                  if (!res) throw Error('Not found: ' + taskKey);

                  // Assign targets
                  if (typeof task.assign === 'function') task.assign(model, res);

                  model[keys.ready] = true;
                }).catch(function (err) {
                  logger.error('TaskMachine(' + _this3.id + ')#worker:catch::taskKey,err', taskKey, err);

                  if (_this3.destroyed) return;

                  model[keys.running] = false;
                  model[keys.error] = err.message;
                }).then(function () {
                  count--;
                });
              });

              // Safety net

              if (!(total > this.maxExecutions)) {
                _context.next = 12;
                break;
              }

              logger.warn('TaskMachine(' + this.id + ')#worker:break::total,maxExecutions', total, this.maxExecutions);
              return _context.abrupt('break', 13);

            case 12:
              if (count > 0 && !this.destroyed) {
                _context.next = 6;
                break;
              }

            case 13:

              logger.log('TaskMachine(' + this.id + ')#worker:done::total', total);

              this.isRunning = false;
              done(true);

            case 16:
            case 'end':
              return _context.stop();
          }
        }
      }, _workerGen, this);
    })

    /**
     * Begin processing all tasks. Uses a generator to manage the tasks.
     */

  }, {
    key: 'start',
    value: function start() {
      var _this4 = this;

      logger.log('TaskMachine(' + this.id + ')#start');

      return new _promise2.default(function (resolve) {
        if (_this4.isRunning || _this4.destroyed) {
          resolve(false);
        } else {
          _this4._worker = _this4._workerGen(resolve);
          _this4._worker.next();
        }
      });
    }
  }, {
    key: 'isRunning',
    get: function get() {
      return this.model[this.propKeys.running];
    },
    set: function set(newIsRunning) {
      if (this.model) this.model[this.propKeys.running] = newIsRunning;

      if (newIsRunning) logger.time('TaskMachine(' + this.id + ').run');else logger.timeEnd('TaskMachine(' + this.id + ').run');
    }
  }]);
  return TaskMachine;
}();