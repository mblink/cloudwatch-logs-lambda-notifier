import { CloudWatchLogs } from 'aws-sdk';
import sendgrid from 'sendgrid';

const cwLogs = new CloudWatchLogs();

const withObj = (obj, ...fns) => fns.forEach(fn => fn(obj));

const getTimeframe = (message) => {
  const timestamp = new Date(message.StateChangeTime);
  return [new Date(+timestamp - (message.Trigger.Period * message.Trigger.EvaluationPeriods * 1000)), timestamp];
};

const getMetricFilters = message => new Promise((resolve, reject) => {
  const params = {
    metricName: message.Trigger.MetricName,
    metricNamespace: message.Trigger.Namespace
  };

  cwLogs.describeMetricFilters(params, (err, data) => (err ? reject(err) : resolve(data)));
});

const getPaginatedLogs = (params, events) => new Promise((resolve, reject) => {
  cwLogs.filterLogEvents(params, (err, data) => {
    if (err) { return reject(err); }
    const newEvents = events.concat(data.events);
    return data.nextToken
      ? getPaginatedLogs(Object.assign(params, { nextToken: data.nextToken }), newEvents).then(resolve)
      : resolve([params, newEvents]);
  });
});

const getLogs = (message, data) => {
  if (data.metricFilters.length === 0) { return Promise.reject(new Error('CloudWatch returned no metric filters')); }

  const [start, end] = getTimeframe(message);
  const metricFilter = data.metricFilters[0];
  const params = {
    logGroupName: metricFilter.logGroupName,
    filterPattern: metricFilter.filterPattern || '',
    startTime: +start,
    endTime: +end
  };

  return getPaginatedLogs(params, []);
};

const buildEmail = (message, [params, events]) => new Promise((resolve) => {
  const from = new sendgrid.mail.Email(process.env.FROM_EMAIL, 'AWS Lambda');
  const to = new sendgrid.mail.Email(process.env.TO_EMAIL);
  const subject = `ALARM: "${message.AlarmName}"`;
  const [start, end] = getTimeframe(message);
  const logsUrl = 'https://console.aws.amazon.com/cloudwatch/home#logEventViewer' +
                    `:group=${params.logGroupName};filter=${encodeURIComponent(params.filterPattern)};` +
                    `start=${start.toISOString()};end=${end.toISOString()}`;
  const messages = events.map((e) => {
    try {
      return JSON.stringify(JSON.parse(e.message), null, 2);
    } catch (_) {
      return e.message;
    }
  });
  const body = new sendgrid.mail.Content('text/html', `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"
      "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <meta name="viewport" content="width=device-width">
        <title>${subject}</title>
      </head>
      <body>
        Alarm: ${message.AlarmName}<br>
        Time: ${end.toString()}<br>
        Logs:<br><br>
        <pre>${messages.join('<hr>')}</pre>
        <br>
        View logs:
        <a href="${logsUrl}">${logsUrl}</a>
      </body>
    </html>
  `);

  resolve(new sendgrid.mail.Mail(from, subject, to, body));
});

const sendEmail = email => withObj(sendgrid(process.env.SENDGRID_API_KEY), sg => sg.API(sg.emptyRequest({
  method: 'POST',
  path: '/v3/mail/send',
  body: email.toJSON()
})));

exports.handler = (event, context, callback) => {
  const message = JSON.parse(event.Records[0].Sns.Message);
  console.log(JSON.stringify({ 'Cloudwatch alarm': message }, null, 2));

  getMetricFilters(message)
    .then(getLogs.bind(null, message))
    .then(buildEmail.bind(null, message))
    .then(sendEmail)
    .then(r => withObj(
      { 'SendGrid response': { code: r.statusCode, body: r.body, headers: r.headers } },
      res => console.log(JSON.stringify(res, null, 2)),
      callback.bind(null, null)
    ))
    .catch(e => withObj(e, console.error, callback));
};
