import '../setup';
import prettyPrint from '../../src/transformers/pretty-print';

describe('prettyPrint', () => {
  const objects = {
    object: { in: { test: 'message' }, out: '{\n  "test": "message"\n}' },
    array: { in: ['test', 'message'], out: '[\n  "test",\n  "message"\n]' }
  };
  Object.keys(objects).forEach(type =>
    it(`pretty prints ${type}s with two spaces`, () =>
      prettyPrint(objects[type].in).then(parsed => expect(parsed).to.equal(objects[type].out))));

  const nonObjects = { string: 'test', number: 1, boolean: true };
  Object.keys(nonObjects).forEach(type =>
    it(`skips pretty printing for ${type}s`, () =>
      prettyPrint(nonObjects[type]).then(parsed => expect(parsed).to.equal(nonObjects[type]))));
});
