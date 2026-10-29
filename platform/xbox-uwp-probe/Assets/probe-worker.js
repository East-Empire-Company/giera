self.onmessage = async (event) => {
  const report = {
    module: true,
    ping: event.data ? event.data.ping : null,
    at: [1, 2, 3].at(-1),
    hasOwn: Object.hasOwn({ a: 1 }, 'a'),
  };
  try {
    const res = await fetch('/Assets/probe-data.json', { cache: 'no-store' });
    report.fetchStatus = res.status;
    report.fetchBytes = (await res.text()).length;
  } catch (e) {
    report.fetchError = e.message;
  }
  self.postMessage(report);
};