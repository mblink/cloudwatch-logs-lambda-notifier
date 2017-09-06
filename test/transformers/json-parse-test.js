import '../setup';
import jsonParse from '../../src/transformers/json-parse';

describe('jsonParse', () => {
  it('parses JSON strings', () =>
    jsonParse('{"test": "message"}').then(parsed => expect(parsed).to.deep.equal({ test: 'message' })));

  it('returns the original for invalid JSON', () =>
    jsonParse('{"test":').then(parsed => expect(parsed).to.equal('{"test":')));

  it('returns the original for non-string values', () =>
    jsonParse({ test: 'message' }).then(parsed => expect(parsed).to.deep.equal({ test: 'message' })));
});
