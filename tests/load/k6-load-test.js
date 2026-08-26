import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '15s', target: 25 },  // Ramp-up to 25 VUs
    { duration: '30s', target: 100 }, // Peak stress at 100 VUs
    { duration: '15s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'], // 95% of requests must complete under 200ms
    http_req_failed: ['rate<0.01'],    // Less than 1% failure rate
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || 'amr_live_test_developer_key_000000000000000000000000';

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  };

  // 1. Query Public Models Catalog
  const resModels = http.get(`${BASE_URL}/api/v1/models?limit=50`, { headers });
  check(resModels, {
    'models status is 200': (r) => r.status === 200,
    'models payload contains data': (r) => r.json().data !== undefined,
  });

  // 2. Query Keyset-Paginated Events Feed
  const resEvents = http.get(`${BASE_URL}/api/v1/events?limit=25`, { headers });
  check(resEvents, {
    'events status is 200': (r) => r.status === 200,
    'events has rate limit header': (r) => r.headers['X-Ratelimit-Limit'] !== undefined,
  });

  // 3. Query Arbitrage Opportunities
  const resArbitrage = http.get(`${BASE_URL}/api/v1/arbitrage`, { headers });
  check(resArbitrage, {
    'arbitrage status is 200': (r) => r.status === 200,
  });

  sleep(0.5);
}
