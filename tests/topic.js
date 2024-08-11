var test = require('tape');
var { TopicManager } = require('../src/topic.js');

test('Hubs URLs are correctly added to and removed from topics', function(t) {
  var tm = new TopicManager(["hubsfoundation.org"]);
  t.equal(tm.addHub("", "https://hubsfoundation.org/foobars"), "https://hubsfoundation.org/foobars");
  t.equal(tm.addHub("whatever", "https://hubsfoundation.org/foobars"), "whatever | https://hubsfoundation.org/foobars");
  t.equal(tm.removeHub("whatever | https://hubsfoundation.org/foobars"), "whatever");
  t.equal(tm.removeHub("whatever"), "whatever");
  t.equal(tm.removeHub("http://zombo.com"), "http://zombo.com");
  t.end();
});

test('Hubs URLs are correctly identified', function(t) {
  var tm = new TopicManager(["foo", "bar.hubsfoundation.org", "hubs.local:8080", "localhost"]);
  // path form: hub IDs must be exactly 7 characters and followed by an optional slug
  t.equal(tm.matchHub("https://foo/0123456/").hubId, "0123456");
  t.equal(tm.matchHub("http://foo/fiddles/blah-blah-blah").hubId, "fiddles");
  t.equal(tm.matchHub("https://bar.hubsfoundation.org/spoke"), null);
  t.equal(tm.matchHub("https://bar.hubsfoundation.org/s0mething/"), null);
  t.equal(tm.matchHub("http://bar.hubsfoundation.org/"), null);
  t.equal(tm.matchHub("https://bar.hubsfoundation.org/d0gf00d").hubId, "d0gf00d");
  t.equal(tm.matchHub("https://foo.bar.hubsfoundation.org/whatever/"), null);
  t.equal(tm.matchHub("http://zombo.com/hmmmm"), null);
  t.equal(tm.matchHub("https://foo/index.html"), null);
  // query form: hub IDs are 7 characters in the query parameter, useful for local dev
  t.equal(tm.matchHub("https://hubs.local:8080/hub.html?hub_id=a0b1c2d").hubId, "a0b1c2d");
  t.equal(tm.matchHub("https://hubs.local:443/hub.html"), null);
  t.equal(tm.matchHub("http://localhost/hub.html?hub_id=foobar1").hubId, "foobar1");
  t.equal(tm.matchHub("https://localhots/hub.html?hub_id=foobar1"), null);
  t.end();
});

test('Scene URLs are correctly identified', function(t) {
  var tm = new TopicManager(["hubsfoundation.org", "hubs.local:8080"]);
  // scene IDs must be exactly 7 characters and followed by an optional slug
  t.equal(tm.matchScene("http://foo/scenes/blah-blah-blah"), null);
  t.equal(tm.matchScene("https://hubsfoundation.org/scenes/d0gf00d/ponies").sceneId, "d0gf00d");
  t.equal(tm.matchScene("https://hubsfoundation.org/d0gf00d/ponies"), null);
  t.equal(tm.matchScene("https://hubs.local:8080/scenes/wwwwwww").sceneId, "wwwwwww");
  t.equal(tm.matchScene("https://hubs.local:8080/scenes/wwwwwwww"), null);
  t.end();
});
