var test = require('tape');
var ChannelBindings = require('../src/bindings.js').ChannelBindings;

test('Hubs URLs are detected in channel topics', function(t) {
  var bindings = new ChannelBindings(["foo", "bar.mozilla.com"]);
  t.deepEqual(bindings.getHub("https://foo/fiddle/blah-blah-blah"), "fiddle");
  t.deepEqual(bindings.getHub("https://bar.mozilla.com/s0mething/"), "s0mething");
  t.deepEqual(bindings.getHub("https://bar.mozilla.com/"), null);
  t.deepEqual(bindings.getHub("https://foo.bar.mozilla.com/whatever/"), null);
  t.deepEqual(bindings.getHub("https://zombo.com/hmmmm"), null);
  // todo: should we really be matching stuff like this?
  t.deepEqual(bindings.getHub("https://foo/index.html"), "index");
  t.end();
});
