import { unstable_startWorker } from 'wrangler';

const worker = await unstable_startWorker({
  dev: {
    experimentalNewConfig: true, remote: false, persist: false,
    watch: false, server: { hostname: '127.0.0.1', port: 8788 }, inspector: false,
  },
});
process.on('SIGTERM', async () => { await worker.dispose(); process.exit(0); });
