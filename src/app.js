import express from 'express';
import path from 'node:path';
import { ROOT_DIR } from './config.js';
import { createApiRouter } from './routes/api.js';

/** 의존성을 주입받아 Express 앱을 만든다 (테스트에서 가짜 서비스 주입 가능) */
export function createApp(deps) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  app.use('/api', createApiRouter(deps));

  // Leaflet은 CDN 대신 설치된 패키지에서 직접 제공 (터널·오프라인 환경에서도 동작)
  app.use('/vendor/leaflet', express.static(path.join(ROOT_DIR, 'node_modules', 'leaflet', 'dist'), { maxAge: '7d' }));
  app.use(express.static(path.join(ROOT_DIR, 'public'), { maxAge: 0 }));

  return app;
}
