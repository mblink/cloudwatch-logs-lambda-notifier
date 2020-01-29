import { CloudWatchLogs, SNS } from 'aws-sdk';
import he from 'he';
import sendgrid from '@sendgrid/mail';
import State from 'lambda-state';

import jsonParse from './transformers/json-parse';
import prettyPrint from './transformers/pretty-print';
import htmlEncode from './transformers/html-encode';

const transformers = [jsonParse, prettyPrint, htmlEncode];

const stackTrace = e => (e.stack || []).split('\n').slice(1).map(l => l.trim().replace(/^at /, ''));

class CloudwatchLogsNotifier {
  static setupSendGrid() { sendgrid.setApiKey(process.env.SENDGRID_API_KEY); return sendgrid; }

  constructor(event) {
    this.cwLogs = new CloudWatchLogs();
    this.sns = new SNS();
    this.sendgrid = CloudwatchLogsNotifier.setupSendGrid();
    this.event = event;
    this.message = JSON.parse(event.Records[0].Sns.Message);
    this.snsTopicArn = event.Records[0].Sns.TopicArn;

    const ts = new Date(this.message.StateChangeTime);
    this.start = new Date(+ts - (this.message.Trigger.Period * this.message.Trigger.EvaluationPeriods * 1000));
    this.end = ts;
  }

  handle(callback) {
    return State.init()
      .then(State.info('CloudWatch alarm event', this.event))
      .then(this.getMetricFilters.bind(this))
      .then(State.info('CloudWatch metrics filters'))
      .then(this.getLogs.bind(this))
      .then(State.info('CloudWatch filtered logs'))
      .then(this.getToEmails.bind(this))
      .then(State.info('To email addresses'))
      .then(this.buildEmail.bind(this))
      .then(State.info('SendGrid email'))
      .then(this.sendEmail.bind(this))
      .then(State.info('SendGrid response'))
      .catch(e => State.error(e.name || 'Unknown error', { error: e.toString(), stack: stackTrace(e) })())
      .then(() => State.finalize(callback));
  }

  getMetricFilters() {
    return new Promise((resolve, reject) => {
      const params = {
        metricName: this.message.Trigger.MetricName,
        metricNamespace: this.message.Trigger.Namespace
      };

      this.cwLogs.describeMetricFilters(params, (err, data) => (err ? reject(err) : resolve(data)));
    });
  }

  paginate(fn, get, ntParam, params, items) {
    return new Promise((resolve, reject) => fn(params, (err, data) => {
      if (err) { return reject(err); }
      const nItems = (items || []).concat(get(data));
      return data[ntParam]
        ? this.paginate(fn, get, ntParam, Object.assign(params, { [ntParam]: data[ntParam] }), nItems).then(resolve)
        : resolve([params, nItems]);
    }));
  }

  getLogs(data) {
    if (data.metricFilters.length === 0) {
      return Promise.reject(new Error('CloudWatch returned no metric filters'));
    }

    const metricFilter = data.metricFilters[0];
    const params = {
      logGroupName: metricFilter.logGroupName,
      filterPattern: metricFilter.filterPattern || '',
      startTime: +this.start,
      endTime: +this.end
    };

    return this.paginate(this.cwLogs.filterLogEvents.bind(this.cwLogs), d => d.events, 'nextToken', params);
  }

  getToEmails([cwParams, events]) {
    if (process.env.TO_EMAIL !== 'USE_SNS_SUBSCRIPTIONS') {
      return Promise.resolve([cwParams, events, [process.env.TO_EMAIL]]);
    }

    const params = { TopicArn: this.snsTopicArn };
    return this.paginate(this.sns.listSubscriptionsByTopic.bind(this.sns), d => d.Subscriptions, 'NextToken', params)
      .then(arr => arr[1].filter(s => s.Protocol === 'email').map(sub => sub.Endpoint))
      .then(emails => [cwParams, events, emails]);
  }

  buildEmail([params, events, toEmails]) {
    return Promise.all(
      events.map(e => transformers.reduce((acc, transformer) =>
        acc.then(logLine => transformer(logLine)), Promise.resolve(e.message))))
      .then(messages => {
        try {
          return Promise.resolve([messages, JSON.parse(process.env.SENDGRID_CUSTOM_ARGS || '{}')]);
        } catch (err) {
          return State.warn('Failed to parse SendGrid custom args',
            { err, env: process.env.SENDGRID_CUSTOM_ARGS })([messages, {}]);
        }
      })
      .then(([messages, customArgs]) => {
        const logsUrl = 'https://console.aws.amazon.com/cloudwatch/home#logEventViewer:'
                          + `group=${encodeURIComponent(params.logGroupName)};`
                          + `filter=${encodeURIComponent(params.filterPattern)};`
                          + `start=${encodeURIComponent(this.start.toISOString())};`
                          + `end=${encodeURIComponent(this.end.toISOString())}`;
        return {
          to: toEmails,
          from: { name: 'AWS Lambda', email: process.env.FROM_EMAIL },
          subject: `ALARM: "${this.message.AlarmName}"`,
          html: `Alarm: ${he.encode(this.message.AlarmName)}<br>
            Time: ${he.encode(this.end.toString())}<br>
            Logs:<br><br>
            <pre>${messages.join('<hr>')}</pre>
            <br>
            <a href="${he.encode(logsUrl)}">View logs in CloudWatch</a>`,
          customArgs
        };
      });
  }

  sendEmail(message) {
    return this.sendgrid.send(message);
  }
}

const handler = (event, context, callback) => new CloudwatchLogsNotifier(event).handle(callback);

export {
  CloudwatchLogsNotifier,
  handler
};
