var test = require('tape');
var { PresenceRollups } = require('../src/presence-rollups.js');

test('PresenceRollups rolls up arrivals and departures correctly', function(t) {

  var q = new PresenceRollups({
    arrive_rollup_leeway_ms: 1,
    depart_rollup_leeway_ms: 2,
    depart_rejoin_patience_ms: 10
  });
  var log = [];
  function latest() {
    return log[log.length - 1];
  }
  q.on("new", ev => log.push(Object.assign({ e: 'new' }, ev)));
  q.on("update", ev => log.push(Object.assign({ e: 'update' }, ev)));

  q.arrive(0, "Alice", 0);
  t.deepEqual(latest(), { e: 'new', kind: 'arrive', users: [{ id: 0, name: 'Alice' }], timestamp: 0});
  q.arrive(1, "Bob", 1);
  t.deepEqual(latest(), { e: 'update', kind: 'arrive', users: [{ id: 0, name: 'Alice' }, { id: 1, name: 'Bob'}], timestamp: 1});
  q.arrive(2, "Charlie", 3);
  t.deepEqual(latest(), { e: 'new', kind: 'arrive', users: [{ id: 2, name: 'Charlie' }], timestamp: 3});
  q.finalizeDeparture(1, "Bob", 4);
  t.deepEqual(latest(), { e: 'new', kind: 'depart', users: [{ id: 1, name: 'Bob' }], timestamp: 4});
  q.arrive(3, "David", 4);
  t.deepEqual(latest(), { e: 'new', kind: 'arrive', users: [{ id: 3, name: 'David' }], timestamp: 4});
  q.finalizeDeparture(0, "Alice", 10);
  t.deepEqual(latest(), { e: 'new', kind: 'depart', users: [{ id: 0, name: 'Alice' }], timestamp: 10});
  q.finalizeDeparture(2, "Charlie", 12);
  t.deepEqual(latest(), { e: 'update', kind: 'depart', users: [{ id: 0, name: 'Alice' }, { id: 2, name: 'Charlie' }], timestamp: 12});
  q.finalizeDeparture(3, "David", 12);
  t.deepEqual(latest(), { e: 'update', kind: 'depart', users: [{ id: 0, name: 'Alice' }, { id: 2, name: 'Charlie' }, { id: 3, name: 'David' }], timestamp: 12});

  t.end();
});
