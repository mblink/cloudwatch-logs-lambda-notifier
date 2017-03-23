const CloudWatchLogs = {
  describeMetricFilters(_, callback) {
    callback(null, { metricFilters: [{ logGroupName: 'test group', filterPattern: 'test filter' }] });
  },

  filterLogEvents(_, callback) { callback(null, { events: [] }); }
};

const sendgrid = {
  emptyRequest(params) { return params; },
  API() { return Promise.resolve({ statusCode: 200, body: 'test body', headers: ['test header'] }); }
};

export { CloudWatchLogs, sendgrid };
