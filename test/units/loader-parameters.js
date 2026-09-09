'use strict';

var assert = require('assert');
var yaml = require('../..');


function assertYamlException(fn, pattern) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof yaml.YAMLException, 'expected YAMLException, got ' + error.name);

    if (pattern) {
      assert.ok(pattern.test(error.message), 'expected "' + error.message + '" to match ' + pattern);
    }

    return;
  }

  assert.fail('expected YAMLException');
}


// Each `a{i}` merges the previous anchor and adds a single key, so the final
// mapping has `count` keys while the loader copies ~count^2/2 keys in total.
function createMergeChain(count) {
  var lines = [ 'a0: &a0 { k0: 0 }' ];
  var i;

  for (i = 1; i < count; i += 1) {
    lines.push('a' + i + ': &a' + i + ' { <<: *a' + (i - 1) + ', k' + i + ': ' + i + ' }');
  }

  lines.push('b: *a' + (count - 1));

  return lines.join('\n') + '\n';
}


// A single anchor with `keys` keys, merged `repetitions` times into the same
// mapping, so the loader walks `repetitions * keys` keys in total.
function createRepeatedMergeAliasPattern(repetitions, keys) {
  var src = [];
  var aliases = [];
  var i;

  for (i = 0; i < keys; i += 1) {
    src.push('k' + i + ': 0');
  }

  for (i = 0; i < repetitions; i += 1) {
    aliases.push('*a');
  }

  return '\na: &a {' + src.join(', ') + '}\nb: { <<: [ ' + aliases.join(', ') + ' ] }\n';
}


// `n` anchored single-key mappings, all folded into one merge sequence.
function createMergeSequence(n) {
  var lines = [];
  var aliases = [];
  var i;

  for (i = 0; i < n; i += 1) {
    lines.push('- &x' + i + ' {a' + i + ': ' + i + '}');
    aliases.push('*x' + i);
  }

  return lines.join('\n') + '\n- <<: [' + aliases.join(', ') + ']\n';
}


var MULTI_DOCUMENT_MERGE = [
  '',
  '---',
  'a: &a { k1: 1, k2: 2 }',
  'b: { <<: *a }',
  '---',
  'a: &a { k1: 1, k2: 2 }',
  'b: { <<: *a }',
  ''
].join('\n');


suite('loader parameters', function () {
  var testStr = 'test: 1 \ntest: 2';
  var expected =  [ { test: 2 } ];
  var result;

  test('loadAll(input, options)', function () {
    result = yaml.loadAll(testStr, { json: true });
    assert.deepEqual(result, expected);

    result = [];
    yaml.loadAll(testStr, function (doc) {
      result.push(doc);
    }, { json: true });
    assert.deepEqual(result, expected);
  });

  test('loadAll(input, null, options)', function () {
    result = yaml.loadAll(testStr, null, { json: true });
    assert.deepEqual(result, expected);

    result = [];
    yaml.loadAll(testStr, function (doc) {
      result.push(doc);
    }, { json: true });
    assert.deepEqual(result, expected);
  });

  test('safeLoadAll(input, options)', function () {
    result = yaml.safeLoadAll(testStr, { json: true });
    assert.deepEqual(result, expected);

    result = [];
    yaml.safeLoadAll(testStr, function (doc) {
      result.push(doc);
    }, { json: true });
    assert.deepEqual(result, expected);
  });

  test('safeLoadAll(input, null, options)', function () {
    result = yaml.safeLoadAll(testStr, null, { json: true });
    assert.deepEqual(result, expected);

    result = [];
    yaml.safeLoadAll(testStr, function (doc) {
      result.push(doc);
    }, { json: true });
    assert.deepEqual(result, expected);
  });

  test('maxTotalMergeKeys - caps total merge keys', function () {
    assert.doesNotThrow(function () {
      yaml.load(createMergeSequence(3), { maxTotalMergeKeys: 5 });
    });

    assert.throws(function () {
      yaml.load(createMergeSequence(3), { maxTotalMergeKeys: 2 });
    }, /maxTotalMergeKeys/);

    assert.doesNotThrow(function () {
      yaml.load(createMergeSequence(3), { maxTotalMergeKeys: -1 });
    });

    var chained = yaml.load(createMergeChain(150), { maxTotalMergeKeys: -1 });

    assert.strictEqual(Object.keys(chained.b).length, 150);
  });

  test('maxTotalMergeKeys - default cap stops a pathological merge chain', function () {
    assertYamlException(function () {
      yaml.load(createMergeChain(100000));
    }, /merge keys exceeded maxTotalMergeKeys \(10000\)/);
  });

  test('maxTotalMergeKeys - default cap stops repeated merge aliases', function () {
    assertYamlException(function () {
      yaml.load(createRepeatedMergeAliasPattern(50000, 20000));
    }, /merge keys exceeded maxTotalMergeKeys \(10000\)/);
  });

  test('maxTotalMergeKeys - every merge source is counted', function () {
    // Repeated aliases are not deduplicated, so three sources of two keys
    // each consume six of the allowance.
    assert.doesNotThrow(function () {
      yaml.load(createRepeatedMergeAliasPattern(3, 2), { maxTotalMergeKeys: 6 });
    });

    assert.throws(function () {
      yaml.load(createRepeatedMergeAliasPattern(3, 2), { maxTotalMergeKeys: 5 });
    }, /maxTotalMergeKeys/);

    var merged = yaml.load(createRepeatedMergeAliasPattern(3, 2), { maxTotalMergeKeys: -1 });

    assert.deepEqual(merged.b, { k0: 0, k1: 0 });
  });

  test('loadAll - maxTotalMergeKeys is shared across all documents', function () {
    assert.doesNotThrow(function () {
      yaml.loadAll(MULTI_DOCUMENT_MERGE, { maxTotalMergeKeys: 4 });
    });

    assert.throws(function () {
      yaml.loadAll(MULTI_DOCUMENT_MERGE, { maxTotalMergeKeys: 3 });
    }, /maxTotalMergeKeys/);
  });

  test('safeLoad - maxTotalMergeKeys is honoured', function () {
    assert.doesNotThrow(function () {
      yaml.safeLoad(createMergeSequence(3), { maxTotalMergeKeys: 5 });
    });

    assert.throws(function () {
      yaml.safeLoad(createMergeSequence(3), { maxTotalMergeKeys: 2 });
    }, /maxTotalMergeKeys/);

    assertYamlException(function () {
      yaml.safeLoad(createMergeChain(100000));
    }, /merge keys exceeded maxTotalMergeKeys \(10000\)/);
  });

  test('safeLoadAll - maxTotalMergeKeys is shared across all documents', function () {
    assert.doesNotThrow(function () {
      yaml.safeLoadAll(MULTI_DOCUMENT_MERGE, { maxTotalMergeKeys: 4 });
    });

    assert.throws(function () {
      yaml.safeLoadAll(MULTI_DOCUMENT_MERGE, { maxTotalMergeKeys: 3 });
    }, /maxTotalMergeKeys/);

    assert.throws(function () {
      yaml.safeLoadAll(MULTI_DOCUMENT_MERGE, null, { maxTotalMergeKeys: 3 });
    }, /maxTotalMergeKeys/);
  });
});
