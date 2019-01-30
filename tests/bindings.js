var test = require('tape');
var ChannelBindings = require('../src/bindings.js').ChannelBindings;

test('Hubs URLs are detected in channel topics', function(t) {
  var bindings = new ChannelBindings(["foo", "bar.mozilla.com"]);
  // hub IDs must be exactly 7 characters and followed by an optional slug
  t.deepEqual(bindings.getHub("https://foo/0123456/"), "0123456");
  t.deepEqual(bindings.getHub("https://foo/fiddles/blah-blah-blah"), "fiddles");
  t.deepEqual(bindings.getHub("https://bar.mozilla.com/spoke"), null);
  t.deepEqual(bindings.getHub("https://bar.mozilla.com/s0mething/"), null);
  t.deepEqual(bindings.getHub("https://bar.mozilla.com/"), null);
  t.deepEqual(bindings.getHub("https://bar.mozilla.com/d0gf00d"), "d0gf00d");
  t.deepEqual(bindings.getHub("https://foo.bar.mozilla.com/whatever/"), null);
  t.deepEqual(bindings.getHub("https://zombo.com/hmmmm"), null);
  t.deepEqual(bindings.getHub("https://foo/index.html"), null);
  t.end();
});
