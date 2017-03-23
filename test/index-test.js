import AWS from 'aws-sdk';
import sg from 'sendgrid';
import event from './event.json';
import utils from './setup';
import { CloudWatchLogs, sendgrid } from './stubs';
import { CloudwatchLogsNotifier, handler } from '../src/index';
import State from '../src/state';

describe('handler', () => {
  let callback;

  const assertCallback = () => {
    expect(callback).to.have.been.calledOnce();
    expect(callback.firstCall.args[0]).to.be.null();
    expect(callback.firstCall.args[1].trace).to.have.lengthOf(5);
    expect(callback.firstCall.args[1].level).to.equal('info');
  };

  const assertErrorCallback = () => {
    expect(callback).to.have.been.calledOnce();
    expect(callback).to.have.been.calledWithExactly(utils.match.object);
  };

  beforeEach(() => {
    callback = utils.stub();
    utils.stub(AWS, 'CloudWatchLogs').returns(CloudWatchLogs);
    utils.stub(CloudwatchLogsNotifier, 'createSendGridClient').returns(sendgrid);
  });

  describe('AWS API calls', () => {
    it('gets metric filters from AWS', () => {
      utils.spy(CloudWatchLogs, 'describeMetricFilters');
      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(CloudWatchLogs.describeMetricFilters).to.have.been.calledOnce();
        expect(CloudWatchLogs.describeMetricFilters).to.have.been.calledWith(
          { metricName: 'test metric', metricNamespace: 'LogMetricsError' }
        );
      });
    });

    it('filters logs with the first returned metric filter', () => {
      utils.spy(CloudWatchLogs, 'filterLogEvents');
      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(CloudWatchLogs.filterLogEvents).to.have.been.calledOnce();
        expect(CloudWatchLogs.filterLogEvents).to.have.been.calledWith({
          logGroupName: 'test group',
          filterPattern: 'test filter',
          startTime: utils.match.number,
          endTime: utils.match.number
        });
      });
    });

    it('paginates filtered logs', () => {
      const filterStub = utils.stub(CloudWatchLogs, 'filterLogEvents');
      filterStub.onCall(0).callsArgWith(1, null, { events: [{ message: 'test 1' }], nextToken: 'test token' });
      filterStub.onCall(1).callsArgWith(1, null, { events: [{ message: 'test 2' }] });

      utils.spy(CloudwatchLogsNotifier.prototype, 'buildEmail');

      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(CloudWatchLogs.filterLogEvents).to.have.been.calledTwice();
        expect(CloudWatchLogs.filterLogEvents).to.have.been.calledWithMatch({ nextToken: 'test token' });
        expect(CloudwatchLogsNotifier.prototype.buildEmail).to.have.been.calledOnce();
        expect(CloudwatchLogsNotifier.prototype.buildEmail).to.have.been.calledWith(
          [utils.match.object, [{ message: 'test 1' }, { message: 'test 2' }]]
        );
      });
    });
  });

  describe('built SendGrid email', () => {
    beforeEach(() => utils.spy(sg.mail, 'Mail'));

    it('uses the FROM_EMAIL environment variable for the from email', () => {
      process.env.FROM_EMAIL = 'test from';
      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(sg.mail.Mail).to.have.been.calledOnce();
        expect(sg.mail.Mail.firstCall.args[0].email).to.equal('test from');
        expect(sg.mail.Mail.firstCall.args[0].name).to.equal('AWS Lambda');
      });
    });

    it('uses the TO_EMAIL environment variable for the to email', () => {
      process.env.TO_EMAIL = 'test to';
      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(sg.mail.Mail).to.have.been.calledOnce();
        expect(sg.mail.Mail.firstCall.args[2].email).to.equal('test to');
      });
    });

    it('uses the alarm name in the subject', () => handler(event, {}, callback).then(() => {
      assertCallback();
      expect(sg.mail.Mail).to.have.been.calledOnce();
      expect(sg.mail.Mail.firstCall.args[1]).to.equal('ALARM: "test alarm"');
    }));

    it('includes the text of the log messages in the body', () => {
      utils.stub(CloudWatchLogs, 'filterLogEvents').callsArgWith(1, null, {
        events: [{ message: 'test 1' }, { message: 'test 2' }]
      });
      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(sg.mail.Mail).to.have.been.calledOnce();
        expect(sg.mail.Mail.firstCall.args[3].type).to.equal('text/html');
        expect(sg.mail.Mail.firstCall.args[3].value).to.match(/test 1<hr>test 2/);
      });
    });
  });

  describe('SendGrid API calls', () => {
    beforeEach(() => utils.spy(sendgrid, 'API'));

    it('POSTs to the send endpoint', () => handler(event, {}, callback).then(() => {
      assertCallback();
      expect(sendgrid.API).to.have.been.calledOnce();
      expect(sendgrid.API).to.have.been.calledWithMatch({ method: 'POST', path: '/v3/mail/send' });
    }));

    it('sends the built email', () => {
      utils.stub(CloudWatchLogs, 'filterLogEvents').callsArgWith(1, null, { events: [{ message: 'test 1' }] });
      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(sendgrid.API).to.have.been.calledOnce();
        expect(sendgrid.API.firstCall.args[0].body.from).to.deep.equal({ email: 'test from', name: 'AWS Lambda' });
        expect(sendgrid.API.firstCall.args[0].body.subject).to.equal('ALARM: "test alarm"');
        expect(sendgrid.API.firstCall.args[0].body.content[0].type).to.equal('text/html');
        expect(sendgrid.API.firstCall.args[0].body.content[0].value).to.match(/test 1/);
      });
    });
  });

  describe('error handling', () => {
    beforeEach(() => utils.stub(console, 'error'));

    [
      ['State.init', [State, 'init']],
      ['State.info', [State, 'info'], s => s.returns(() => Promise.reject(new Error('State.info error')))],
      [
        'CloudWatchLogs.describeMetricFilters',
        [CloudWatchLogs, 'describeMetricFilters'],
        s => s.callsArgWith(1, new Error('CloudWatchLogs.describeMetricFilters error'))
      ],
      [
        'CloudWatchLogs.filterLogEvents',
        [CloudWatchLogs, 'filterLogEvents'],
        s => s.callsArgWith(1, new Error('CloudWatchLogs.filterLogEvents error'))
      ],
      ['CloudwatchLogsNotifier.prototype.buildEmail', [CloudwatchLogsNotifier.prototype, 'buildEmail']],
      ['sendgrid.API', [sendgrid, 'API']]
    ].forEach(([name, fn, genStub]) => it(`handles failure when calling ${name}`, () => {
      if (typeof genStub === 'function') {
        genStub(utils.stub(...fn));
      } else {
        utils.stub(...fn).returns(Promise.reject(new Error(`${name} error`)));
      }

      return handler(event, {}, callback).then(() => {
        assertErrorCallback();
        expect(fn[0][fn[1]]).to.have.been.called();
      });
    }));
  });
});
