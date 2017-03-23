import utils from './setup';
import State from '../src/state';

const logLevels = ['debug', 'info', 'warn', 'error'];
const logFns = { debug: 'trace', info: 'log', warn: 'warn', error: 'error' };

describe('State', () => {
  beforeEach(() => State.init());

  describe('::init', () => {
    it('initializes a state object with an empty trace', () => expect(State.get().state.trace).to.deep.equal([]));
  });

  logLevels.forEach((level) => {
    describe(`::${level}`, () => it(`adds a trace object with level set to ${level}`, () => {
      State[level](`test ${level}`, { [`${level} key`]: `${level} value` })().then(() => {
        const state = State.get().state;
        expect(state.trace[0].level).to.equal(`${level}`);
        expect(state.trace[0].message).to.equal(`test ${level}`);
        expect(state.trace[0].aux).to.deep.equal({ [`${level} key`]: `${level} value` });
      });
    }));
  });

  describe('::finalize', () => {
    describe('logging', () => {
      beforeEach(() => console.log.restore());

      it('logs with `console.log` when the trace is empty', () => {
        utils.stub(console, 'log');
        State.finalize(() => {});
        expect(console.log).to.have.been.calledOnce();
      });

      logLevels.forEach((level, i) => {
        it(`logs with \`console.${logFns[level]}\` when the trace only has ${level} statements`, () => {
          utils.stub(console, logFns[level]);
          return State[level](level, {})().then(() => {
            State.finalize(() => {});
            expect(console[logFns[level]]).to.have.been.calledOnce();
          });
        });

        it(`logs with \`console.${logFns[level]}\` when the trace has levels up to ${level}`, () => {
          const levels = logLevels.slice(0, i + 1);
          levels.forEach(l => utils.stub(console, logFns[l]));
          return Promise.all(levels.map(l => State[l](l, {})())).then(() => {
            State.finalize(() => {});
            levels.slice(0, -1).forEach(l => expect(console[logFns[l]]).to.not.have.been.called());
            expect(console[logFns[level]]).to.have.been.calledOnce();
          });
        });
      });
    });

    describe('callback', () => {
      logLevels.filter(l => l !== 'error').forEach((level, i) =>
        it(`calls back with success when the level is <= ${level}`, () => {
          const callback = utils.stub();
          const levels = logLevels.slice(0, i + 1);
          console.log.restore();
          levels.forEach(l => utils.stub(console, logFns[l]));
          return Promise.all(levels.map(l => State[l](l, {})())).then(() => {
            State.finalize(callback);
            expect(callback).to.have.been.calledOnce();
            expect(callback).to.have.been.calledWithExactly(null, utils.match.object);
          });
        }));

      it('calls back with error when the level is error', () => {
        const callback = utils.stub();
        utils.stub(console, 'error');
        return State.error('error', {})().then(() => {
          State.finalize(callback);
          expect(callback).to.have.been.calledOnce();
          expect(callback).to.have.been.calledWithExactly(utils.match.object);
        });
      });
    });
  });
});
