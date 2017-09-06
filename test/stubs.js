const CloudWatchLogs = {
  describeMetricFilters(_, callback) {
    callback(null, { metricFilters: [{ logGroupName: 'test group', filterPattern: 'test filter' }] });
  },

  filterLogEvents(_, callback) { callback(null, { events: [] }); }
};

const geoip = {
  lookup: 'test geolocation'
};

const sendgrid = {
  send: Promise.resolve({ statusCode: 200, body: 'test body', headers: ['test header'] })
};

export { CloudWatchLogs, geoip, sendgrid };
