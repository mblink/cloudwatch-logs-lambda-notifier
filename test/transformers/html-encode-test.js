import '../setup';
import htmlEncode from '../../src/transformers/html-encode';

describe('htmlEncode', () => {
  it('encodes special characters', () =>
    htmlEncode('" & < >').then(parsed =>
      expect(parsed).to.equal('&#x22; &#x26; &#x3C; &#x3E;')));
});
