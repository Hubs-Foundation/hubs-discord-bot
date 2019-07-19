const EventEmitter = require('events');
const moment = require('moment-timezone');
const schedule = require('node-schedule');

// Maintains a list of scheduled notifications associated with individual Discord channels,
// runs a job to keep an eye on them, and fires an event when a notification should be activated.
class NotificationManager extends EventEmitter {
  constructor() {
    super();
    this.data = new Map(); // { moment: Set(notificationMessages) }
  }

  _fire(timestamp, msg) {
    this.emit("notify", timestamp, msg);
  }

  add(timestamp, msg) {
    let msgs = this.data.get(timestamp);
    if (msgs == null) {
      msgs = new Set();
      this.data.set(timestamp, msgs);
    }
    msgs.add(msg);
  }

  remove(timestamp, msg) {
    const msgs = this.data.get(timestamp);
    if (msgs != null) {
      msgs.remove(msg);
      if (msgs.size === 0) {
        delete this.data[timestamp];
      }
    }
  }

  static formatMessage(timestamp) {
    return `Meetup notification scheduled for: ${timestamp.format("LLLL z")}`;
  }

  static parseTimestamp(msg) {
    const match = /Meetup notification scheduled for: (.*)$/.exec(msg.content);
    return match != null ? moment(match[1], "LLLL z") : moment.invalid();
  }

  // Starts up the monitoring job so that it will fire any scheduled notifications.
  start() {
    const rule = new schedule.RecurrenceRule(null, null, null, null, null, null, 0);
    return schedule.scheduleJob(rule, (date) => {
      const now = moment(date);
      for (const [ts, msgs] of this.data.entries()) {
        if (ts.isSame(now, "minute")) {
          this.data.delete(ts);
          for (const msg of msgs) {
            this._fire(ts, msg);
          }
        }
      }
    });
  }
}

module.exports = { NotificationManager };
