import AWS from 'aws-sdk';
import geo from 'geoip-lite';
import sg from '@sendgrid/mail';
import State from 'lambda-state';
import event from './event.json';
import utils from './setup';
import { CloudWatchLogs, geoip, sendgrid, SNS } from './stubs';
import { CloudwatchLogsNotifier, handler } from '../src/index';

describe('handler', () => {
  let callback;

  const assertCallback = () => {
    expect(callback).to.have.been.calledOnce();
    expect(callback.firstCall.args[0]).to.be.null();
    expect(callback.firstCall.args[1].trace).to.have.lengthOf(6);
    expect(callback.firstCall.args[1].level).to.equal('info');
  };

  const assertErrorCallback = () => {
    expect(callback).to.have.been.calledOnce();
    expect(callback).to.have.been.calledWithExactly(utils.match.object);
  };

  beforeEach(() => {
    callback = utils.stub();
    utils.stub(AWS, 'CloudWatchLogs').returns(CloudWatchLogs);
    utils.stub(AWS, 'SNS').returns(SNS);
    Object.keys(sendgrid).forEach(k => utils.stub(sg, k).returns(sendgrid[k]));
    Object.keys(geoip).forEach(k => utils.stub(geo, k).returns(geoip[k]));
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

      utils.spy(CloudwatchLogsNotifier.prototype, 'getToEmails');

      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(CloudWatchLogs.filterLogEvents).to.have.been.calledTwice();
        expect(CloudWatchLogs.filterLogEvents).to.have.been.calledWithMatch({ nextToken: 'test token' });
        expect(CloudwatchLogsNotifier.prototype.getToEmails).to.have.been.calledOnce();
        expect(CloudwatchLogsNotifier.prototype.getToEmails).to.have.been.calledWith(
          [utils.match.object, [{ message: 'test 1' }, { message: 'test 2' }]]
        );
      });
    });
  });

  describe('to email addresses', () => {
    beforeEach(() => utils.spy(CloudwatchLogsNotifier.prototype, 'sendEmail'));

    describe('when the TO_EMAIL environment variable is not USE_SNS_SUBSCRIPTIONS', () => {
      it('uses the TO_EMAIL environment variable by default', () => {
        process.env.TO_EMAIL = 'test to';
        return handler(event, {}, callback).then(() => {
          assertCallback();
          expect(CloudwatchLogsNotifier.prototype.sendEmail).to.have.been.calledOnce();
          expect(CloudwatchLogsNotifier.prototype.sendEmail.firstCall.args[0].to).to.deep.equal(['test to']);
        });
      });
    });

    describe('when the TO_EMAIL environment variable is USE_SNS_SUBSCRIPTIONS', () => {
      let origToEmail;
      beforeEach(() => { origToEmail = process.env.TO_EMAIL; process.env.TO_EMAIL = 'USE_SNS_SUBSCRIPTIONS'; });
      afterEach(() => (process.env.TO_EMAIL = origToEmail));

      it('looks up SNS subscriptions by topic arn', () => {
        utils.spy(SNS, 'listSubscriptionsByTopic');
        return handler(event, {}, callback).then(() => {
          assertCallback();
          expect(SNS.listSubscriptionsByTopic).to.have.been.calledOnce();
          expect(SNS.listSubscriptionsByTopic).to.have.been.calledWith({ TopicArn: 'test topic arn' });
        });
      });

      it('uses email SNS subscriptions', () => {
        const subs = [
          { Protocol: 'email', Endpoint: 'test sns email 1' },
          { Protocol: 'email', Endpoint: 'test sns email 2' }
        ];
        utils.stub(SNS, 'listSubscriptionsByTopic').callsArgWith(1, null, { Subscriptions: subs });

        return handler(event, {}, callback).then(() => {
          assertCallback();
          expect(SNS.listSubscriptionsByTopic).to.have.been.calledOnce();
          expect(CloudwatchLogsNotifier.prototype.sendEmail.firstCall.args[0].to).to.deep.equal(
            ['test sns email 1', 'test sns email 2']);
        });
      });

      it('paginates SNS subscriptions', () => {
        const sub1 = { Protocol: 'email', Endpoint: 'test sns paginated email 1' };
        const sub2 = { Protocol: 'email', Endpoint: 'test sns paginated email 2' };
        const stub = utils.stub(SNS, 'listSubscriptionsByTopic');
        stub.onCall(0).callsArgWith(1, null, { Subscriptions: [sub1], NextToken: 'test token' });
        stub.onCall(1).callsArgWith(1, null, { Subscriptions: [sub2] });

        return handler(event, {}, callback).then(() => {
          assertCallback();
          expect(SNS.listSubscriptionsByTopic).to.have.been.calledTwice();
          expect(SNS.listSubscriptionsByTopic).to.have.been.calledWithMatch({ NextToken: 'test token' });
          expect(CloudwatchLogsNotifier.prototype.sendEmail.firstCall.args[0].to).to.deep.equal(
            ['test sns paginated email 1', 'test sns paginated email 2']);
        });
      });
    });
  });

  describe('built SendGrid email', () => {
    beforeEach(() => utils.spy(CloudwatchLogsNotifier.prototype, 'sendEmail'));

    it('uses the FROM_EMAIL environment variable for the from email', () => {
      process.env.FROM_EMAIL = 'test from';
      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(CloudwatchLogsNotifier.prototype.sendEmail).to.have.been.calledOnce();
        expect(CloudwatchLogsNotifier.prototype.sendEmail.firstCall.args[0].from.email).to.equal('test from');
        expect(CloudwatchLogsNotifier.prototype.sendEmail.firstCall.args[0].from.name).to.equal('AWS Lambda');
      });
    });

    it('uses the alarm name in the subject', () => handler(event, {}, callback).then(() => {
      assertCallback();
      expect(CloudwatchLogsNotifier.prototype.sendEmail).to.have.been.calledOnce();
      expect(CloudwatchLogsNotifier.prototype.sendEmail.firstCall.args[0].subject).to.equal('ALARM: "test alarm"');
    }));

    it('includes the text of the log messages in the body', () => {
      utils.stub(CloudWatchLogs, 'filterLogEvents').callsArgWith(1, null, {
        events: [{ message: 'test 1' }, { message: 'test 2' }]
      });
      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(CloudwatchLogsNotifier.prototype.sendEmail).to.have.been.calledOnce();
        expect(CloudwatchLogsNotifier.prototype.sendEmail.firstCall.args[0].html).to.match(/test 1<hr>test 2/);
      });
    });

    ['forwarded-for-ip', 'ip'].forEach(key =>
      it(`adds geolocation data to JSON logs with "${key}" field`, () => {
        utils.stub(CloudWatchLogs, 'filterLogEvents').callsArgWith(1, null, {
          events: [{ message: `{"${key}": "1.1.1.1"}` }]
        });
        return handler(event, {}, callback).then(() => {
          assertCallback();
          expect(CloudwatchLogsNotifier.prototype.sendEmail).to.have.been.calledOnce();
          expect(CloudwatchLogsNotifier.prototype.sendEmail.firstCall.args[0].html)
            .to.match(new RegExp(
              `{\\n {2}&#x22;${key}&#x22;: &#x22;1\\.1\\.1\\.1&#x22;,`
              + '\\n {2}&#x22;geolocation&#x22;: &#x22;test geolocation&#x22;\\n}'));
        });
      }));

    it('html encodes the text of the log messages in the body', () => {
      utils.stub(CloudWatchLogs, 'filterLogEvents').callsArgWith(1, null, {
        events: [{ message: '<div>test</div>' }]
      });
      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(CloudwatchLogsNotifier.prototype.sendEmail).to.have.been.calledOnce();
        expect(CloudwatchLogsNotifier.prototype.sendEmail.firstCall.args[0].html)
          .to.match(/&#x3C;div&#x3E;test&#x3C;\/div&#x3E;/);
      });
    });

    it('pretty prints JSON log messages in the body', () => {
      utils.stub(CloudWatchLogs, 'filterLogEvents').callsArgWith(1, null, {
        events: [{ message: '{"test": true}' }]
      });
      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(CloudwatchLogsNotifier.prototype.sendEmail).to.have.been.calledOnce();
        expect(CloudwatchLogsNotifier.prototype.sendEmail.firstCall.args[0].html)
          .to.match(/\n {2}&#x22;test&#x22;: true\n}/);
      });
    });
  });

  describe('SendGrid API calls', () => {
    it('sends the built email', () => {
      process.env.FROM_EMAIL = 'test from';
      utils.stub(CloudWatchLogs, 'filterLogEvents').callsArgWith(1, null, { events: [{ message: 'test 1' }] });
      return handler(event, {}, callback).then(() => {
        assertCallback();
        expect(sg.send).to.have.been.calledOnce();
        expect(sg.send.firstCall.args[0].from).to.deep.equal({ name: 'AWS Lambda', email: 'test from' });
        expect(sg.send.firstCall.args[0].subject).to.equal('ALARM: "test alarm"');
        expect(sg.send.firstCall.args[0].html).to.match(/test 1/);
        expect(sg.send.firstCall.args[0].text).to.be.undefined();
      });
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      utils.stub(console, 'error');
      sg.send.restore();
    });

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
      ['sendgrid.send', [sg, 'send']]
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
