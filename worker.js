// Entry point for the Workers-with-static-assets deploy model (this project
// was created as a Git-connected Worker, not classic Cloudflare Pages, so
// there's no automatic functions/ directory routing — this file does that
// routing by hand, dispatching to the same handlers used previously).
import { onRequestPost as analyzeCard } from './functions/api/analyze-card.js';
import { onRequestPost as adminLogin } from './functions/api/admin-login.js';
import { onRequestPost as adminLogout } from './functions/api/admin-logout.js';
import { onRequestGet as adminLogs } from './functions/api/admin-logs.js';
import { onRequestGet as adminLog } from './functions/api/admin-log.js';
import { onRequestPost as adminLogDelete } from './functions/api/admin-log-delete.js';
import { onRequestGet as adminUsageGet, onRequestPost as adminUsagePost } from './functions/api/admin-usage.js';

const ROUTES = {
  'POST /api/analyze-card': analyzeCard,
  'POST /api/admin-login': adminLogin,
  'POST /api/admin-logout': adminLogout,
  'GET /api/admin-logs': adminLogs,
  'GET /api/admin-log': adminLog,
  'POST /api/admin-log-delete': adminLogDelete,
  'GET /api/admin-usage': adminUsageGet,
  'POST /api/admin-usage': adminUsagePost,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const handler = ROUTES[`${request.method} ${url.pathname}`];
    if (handler) return handler({ request, env });
    if (url.pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
