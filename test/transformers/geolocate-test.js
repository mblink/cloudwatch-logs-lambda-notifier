import geoip from 'geoip-lite';
import utils from '../setup';
import geolocate from '../../src/transformers/geolocate';

describe('geolocate', () => {
  beforeEach(() => utils.stub(geoip, 'lookup').returns('test geolocation'));

  describe('when the log line is an object', () => {
    it('looks up geolocation data when the object has an "forwarded-for-ip" field', () =>
      geolocate({ 'forwarded-for-ip': '1.1.1.1' }).then((parsed) => {
        expect(geoip.lookup).to.have.been.calledOnce();
        expect(geoip.lookup).to.have.been.calledWithExactly('1.1.1.1');
        expect(parsed.geolocation).to.equal('test geolocation');
      }));

    it('looks up geolocation data when the object has an "ip" field', () =>
      geolocate({ ip: '1.1.1.1' }).then((parsed) => {
        expect(geoip.lookup).to.have.been.calledOnce();
        expect(geoip.lookup).to.have.been.calledWithExactly('1.1.1.1');
        expect(parsed.geolocation).to.equal('test geolocation');
      }));

    it('favors "forwarded-for-ip" over "ip"', () =>
      geolocate({ 'forwarded-for-ip': '1.1.1.1', ip: '2.2.2.2' }).then((parsed) => {
        expect(geoip.lookup).to.have.been.calledOnce();
        expect(geoip.lookup).to.have.been.calledWithExactly('1.1.1.1');
        expect(parsed.geolocation).to.equal('test geolocation');
      }));

    it('skips lookup when the object does not have an "ip" field', () =>
      geolocate({ test: 'message' }).then((parsed) => {
        expect(geoip.lookup).to.not.have.been.called();
        expect(parsed.geolocation).to.be.undefined();
      }));
  });

  describe('when the log line is not an object', () => {
    const lines = { string: 'test', number: 1, boolean: true };
    Object.keys(lines).forEach(type =>
      it(`skips lookup when the log line is a ${type}`, () =>
        geolocate(lines[type]).then((parsed) => {
          expect(geoip.lookup).to.not.have.been.called();
          expect(parsed.geolocation).to.be.undefined();
        })));
  });
});
