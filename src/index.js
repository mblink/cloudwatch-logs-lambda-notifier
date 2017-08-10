import { CloudWatchLogs } from 'aws-sdk';
import he from 'he';
import sendgrid from 'sendgrid';
import State from 'lambda-state';

const stackTrace = e => (e.stack || []).split('\n').slice(1).map(l => l.trim().replace(/^at /, ''));

class CloudwatchLogsNotifier {
  static createSendGridClient() { return sendgrid(process.env.SENDGRID_API_KEY); }

  constructor(event) {
    this.cwLogs = new CloudWatchLogs();
    this.sendgrid = CloudwatchLogsNotifier.createSendGridClient();
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
    return new Promise((resolve) => {
      const from = new sendgrid.mail.Email(process.env.FROM_EMAIL, 'AWS Lambda');
      const to = new sendgrid.mail.Email(process.env.TO_EMAIL);
      const subject = `ALARM: "${this.message.AlarmName}"`;
      const logsUrl = 'https://console.aws.amazon.com/cloudwatch/home#logEventViewer:' +
                        `group=${encodeURIComponent(params.logGroupName)};` +
                        `filter=${encodeURIComponent(params.filterPattern)};` +
                        `start=${encodeURIComponent(this.start.toISOString())};` +
                        `end=${encodeURIComponent(this.end.toISOString())}`;
      const messages = events.map((e) => {
        let message;
        try {
          message = JSON.stringify(JSON.parse(e.message), null, 2);
        } catch (_) {
          message = e.message;
        }
        return he.encode(message);
      });
      const body = new sendgrid.mail.Content('text/html',
        `Alarm: ${he.encode(this.message.AlarmName)}<br>
        Time: ${he.encode(this.end.toString())}<br>
        Logs:<br><br>
        <pre>${messages.join('<hr>')}</pre>
        <br>
        <a href="${he.encode(logsUrl)}">View logs in CloudWatch</a>`);

      resolve(new sendgrid.mail.Mail(from, subject, to, body));
    });
  }

  sendEmail(email) {
    return this.sendgrid.API(this.sendgrid.emptyRequest({
      method: 'POST',
      path: '/v3/mail/send',
      body: email.toJSON()
    }));
  }
}

exports.CloudwatchLogsNotifier = CloudwatchLogsNotifier;
exports.handler = (event, context, callback) => new CloudwatchLogsNotifier(event).handle(callback);
