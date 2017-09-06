import { CloudWatchLogs } from 'aws-sdk';
import he from 'he';
import sendgrid from '@sendgrid/mail';
import State from 'lambda-state';

import jsonParse from './transformers/json-parse';
import geolocate from './transformers/geolocate';
import prettyPrint from './transformers/pretty-print';
import htmlEncode from './transformers/html-encode';

const transformers = [jsonParse, geolocate, prettyPrint, htmlEncode];

const stackTrace = e => (e.stack || []).split('\n').slice(1).map(l => l.trim().replace(/^at /, ''));

class CloudwatchLogsNotifier {
  static setupSendGrid() { sendgrid.setApiKey(process.env.SENDGRID_API_KEY); return sendgrid; }

  constructor(event) {
    this.cwLogs = new CloudWatchLogs();
    this.sendgrid = CloudwatchLogsNotifier.setupSendGrid();
    this.message = JSON.parse(event.Records[0].Sns.Message);

    const ts = new Date(this.message.StateChangeTime);
    this.start = new Date(+ts - (this.message.Trigger.Period * this.message.Trigger.EvaluationPeriods * 1000));
    this.end = ts;
  }

  handle(callback) {
    return State.init()
      .then(State.info('CloudWatch alarm', this.message))
      .then(this.getMetricFilters.bind(this))
      .then(State.info('CloudWatch metrics filters'))
      .then(this.getLogs.bind(this))
      .then(State.info('CloudWatch filtered logs'))
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

  getPaginatedLogs(params, events) {
    return new Promise((resolve, reject) => {
      this.cwLogs.filterLogEvents(params, (err, data) => {
        if (err) { return reject(err); }
        const newEvents = events.concat(data.events);
        return data.nextToken
          ? this.getPaginatedLogs(Object.assign(params, { nextToken: data.nextToken }), newEvents).then(resolve)
          : resolve([params, newEvents]);
      });
    });
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

    return this.getPaginatedLogs(params, []);
  }

  buildEmail([params, events]) {
    return Promise.all(
      events.map(e => transformers.reduce((acc, transformer) =>
        acc.then(logLine => transformer(logLine)), Promise.resolve(e.message))))
      .then((messages) => {
        const logsUrl = 'https://console.aws.amazon.com/cloudwatch/home#logEventViewer:' +
                          `group=${encodeURIComponent(params.logGroupName)};` +
                          `filter=${encodeURIComponent(params.filterPattern)};` +
                          `start=${encodeURIComponent(this.start.toISOString())};` +
                          `end=${encodeURIComponent(this.end.toISOString())}`;
        return {
          to: process.env.TO_EMAIL,
          from: { name: 'AWS Lambda', email: process.env.FROM_EMAIL },
          subject: `ALARM: "${this.message.AlarmName}"`,
          html: `Alarm: ${he.encode(this.message.AlarmName)}<br>
            Time: ${he.encode(this.end.toString())}<br>
            Logs:<br><br>
            <pre>${messages.join('<hr>')}</pre>
            <br>
            <a href="${he.encode(logsUrl)}">View logs in CloudWatch</a>`
        };
      });
  }

  sendEmail(message) {
    return this.sendgrid.send(message);
  }
}

exports.CloudwatchLogsNotifier = CloudwatchLogsNotifier;
exports.handler = (event, context, callback) => new CloudwatchLogsNotifier(event).handle(callback);
