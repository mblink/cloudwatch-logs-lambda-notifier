import {CloudWatchLogs} from 'aws-sdk';
import sendgrid from 'sendgrid';

const cwLogs = new CloudWatchLogs();

const getMetricFilters = (message) => {
  return new Promise((resolve, reject) => {
    const params = {
      metricName: message.Trigger.MetricName,
      metricNamespace: message.Trigger.Namespace
    };

    cwLogs.describeMetricFilters(params, (err, data) => err ? reject(err) : resolve(data));
  });
};

const getLogs = (message, data) => {
  return new Promise((resolve, reject) => {
    if (data.metricFilters.length === 0) { return reject(new Error('CloudWatch returned no metric filters')); }

    const offset = message.Trigger.Period * message.Trigger.EvaluationPeriods * 1000;
    const timestamp = Date.parse(message.StateChangeTime);
    const metricFilter = data.metricFilters[0];
    const params = {
      logGroupName: metricFilter.logGroupName,
      filterPattern: metricFilter.filterPattern || '',
      startTime: timestamp - offset,
      endTime: timestamp
    };

    cwLogs.filterLogEvents(params, (err, data) => err ? reject(err) : resolve([metricFilter.logGroupName, data]));
  });
};

const sendEmail = (message, [logGroupName, data]) => {
  const from = new sendgrid.mail.Email(process.env.FROM_EMAIL, 'AWS Lambda');
  const to = new sendgrid.mail.Email(process.env.TO_EMAIL);
  const subject = `ALARM: "${message.AlarmName}"`;
  const logsUrl = `https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logEventViewer:group=${logGroupName};filter=%257B%2524.status%2520%253D%2520500%257D;start=PT10M`;
  const body = new sendgrid.mail.Content('text/html', `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <meta name="viewport" content="width=device-width">
        <title>${subject}</title>
      </head>
      <body>
        Alarm: ${message.AlarmName}<br>
        Time: ${(new Date(message.StateChangeTime)).toString()}<br>
        Logs:<br><br>
        <pre>${data.events.map(e => { try { return JSON.stringify(JSON.parse(e.message), null, 2); } catch (e) { return e.message; } }).join('<hr>')}</pre>
        <br>
        View logs:
        <a href="${logsUrl}">${logsUrl}</a>
      </body>
    </html>
  `);
  const email = new sendgrid.mail.Mail(from, subject, to, body);
  const sg = sendgrid(process.env.SENDGRID_API_KEY);
  return sg.API(sg.emptyRequest({
    method: 'POST',
    path: '/v3/mail/send',
    body: email.toJSON()
  }));
};

exports.handler = (event, context, callback) => {
  const message = JSON.parse(event.Records[0].Sns.Message);
  console.log('Processing log...');
  console.log(JSON.stringify(message, null, 2));

  getMetricFilters(message)
    .then(getLogs.bind(null, message))
    .then(sendEmail.bind(null, message))
    .then(r => {
      const res = { 'SendGrid response': { code: r.statusCode, body: r.body, headers: r.headers } };
      console.log(JSON.stringify(res, null, 2));
      callback(null, res);
    })
    .catch(e => { console.error(e); callback(e); });
};
