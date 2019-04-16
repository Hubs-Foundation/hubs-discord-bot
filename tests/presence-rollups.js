var test = require('tape');
var { PresenceRollups } = require('../src/presence-rollups.js');

test('PresenceRollups rolls up arrivals and departures correctly', function(t) {
  var q = new PresenceRollups({
    renameLeewayMs: 1,
    arriveRollupLeewayMs: 1,
    departRollupLeewayMs: 2,
    departRejoinPatienceMs: 10
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
  q.rename(1, "Bob", "Bobert", 2);
  t.deepEqual(latest(), { e: 'update', kind: 'arrive', users: [{ id: 0, name: 'Alice' }, { id: 1, name: 'Bobert'}], timestamp: 2});
  q.rename(1, "Bobert", "Bobarino", 4);
  t.deepEqual(latest(), { e: 'new', kind: 'rename', users: [{ id: 1, name: 'Bobarino', prevName: 'Bobert' }], timestamp: 4});
  q.arrive(2, "Charlie", 4);
  t.deepEqual(latest(), { e: 'new', kind: 'arrive', users: [{ id: 2, name: 'Charlie' }], timestamp: 4});
  q.finalizeDeparture(1, "Bob", 4);
  t.deepEqual(latest(), { e: 'new', kind: 'depart', users: [{ id: 1, name: 'Bob' }], timestamp: 4});
  q.arrive(3, "David", 4);
  t.deepEqual(latest(), { e: 'new', kind: 'arrive', users: [{ id: 3, name: 'David' }], timestamp: 4});
  q.finalizeDeparture(0, "Alice", 10);
  t.deepEqual(latest(), { e: 'new', kind: 'depart', users: [{ id: 0, name: 'Alice' }], timestamp: 10});
  q.rename(2, "Charlie", "Chili", 11);
  t.deepEqual(latest(), { e: 'new', kind: 'rename', users: [{ id: 2, name: 'Chili', prevName: 'Charlie' }], timestamp: 11});
  q.finalizeDeparture(2, "Chili", 12);
  t.deepEqual(latest(), { e: 'new', kind: 'depart', users: [{ id: 2, name: 'Chili' }], timestamp: 12});
  q.finalizeDeparture(3, "David", 12);
  t.deepEqual(latest(), { e: 'update', kind: 'depart', users: [{ id: 2, name: 'Chili' }, { id: 3, name: 'David' }], timestamp: 12});

  t.end();
});

test('PresenceRollups works even if the bot starts with people already present', function(t) {
  var q = new PresenceRollups({
    renameLeewayMs: 1,
    arriveRollupLeewayMs: 1,
    departRollupLeewayMs: 1,
    departRejoinPatienceMs: 1
  });
  var log = [];
  function latest() {
    return log[log.length - 1];
  }
  q.on("new", ev => log.push(Object.assign({ e: 'new' }, ev)));
  q.on("update", ev => log.push(Object.assign({ e: 'update' }, ev)));

  q.finalizeDeparture(0, "Alan", 1);
  t.deepEqual(latest(), { e: 'new', kind: 'depart', users: [{ id: 0, name: 'Alan' }], timestamp: 1});
  q.arrive(1, "Brenda", 2);
  t.deepEqual(latest(), { e: 'new', kind: 'arrive', users: [{ id: 1, name: 'Brenda' }], timestamp: 2});
  q.finalizeDeparture(2, "Charlie", 4);
  t.deepEqual(latest(), { e: 'new', kind: 'depart', users: [{ id: 2, name: 'Charlie' }], timestamp: 4});
  q.finalizeDeparture(1, "Brenda", 4);
  t.deepEqual(latest(), { e: 'update', kind: 'depart', users: [{ id: 2, name: 'Charlie' }, { id: 1, name: 'Brenda' }], timestamp: 4});

  t.end();
});
