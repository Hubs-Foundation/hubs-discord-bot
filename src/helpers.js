// Serializes invocations of the tasks in the queue. Used to ensure that we completely finish processing
// a single Discord event before processing the next one, e.g. we don't interleave work from a user command
// and from a channel topic update, or from two channel topic updates in quick succession.
class BotEventQueue {
  constructor(statsdClient = null) {
    this.size = 0;
    this.curr = Promise.resolve();
    this._onSizeChanged();
    this.statsdClient = statsdClient;
  }

  _onSizeChanged() {
    if (this.statsdClient != null) {
      this.statsdClient.send("discord.queuesize", this.size, "g");
    }
  }

  // Enqueues the given function to run as soon as no other functions are currently running.
  enqueue(fn) {
    this.size += 1;
    this._onSizeChanged();
    return (this.curr = this.curr
      .then(_ => fn())
      .catch(e => console.error(ts(e.stack)))
      .finally(() => {
        this.size -= 1;
        this._onSizeChanged();
      }));
  }
}

module.exports = { BotEventQueue };
