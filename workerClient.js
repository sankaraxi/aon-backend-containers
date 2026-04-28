'use strict';

/**
 * workerClient.js
 * Remote container-server HTTP client.
 *
 * Worker API contract expected on each container-server:
 *   GET  /container-server/{n}/health          → 200 { status: 'ok' }
 *   POST /container-server/{n}/provision       → 200 { started: true }
 *   POST /container-server/{n}/destroy         → 200 { destroyed: true }
 *
 * Env vars:
 *   WORKER_BASE_URL        Base URL of the worker host (default: https://aws-testing.starsquare.in)
 *   WORKER_COUNT           Total number of worker servers available (default: 10)
 *   WORKER_MAX_RETRIES     Max retry attempts per dispatch (default: 3)
 *   WORKER_RETRY_DELAY_MS  Base delay between retries in ms — doubles each attempt (default: 1000)
 *   WORKER_HEALTH_TIMEOUT  Health check HTTP timeout in ms (default: 3000)
 *   WORKER_DISPATCH_TIMEOUT Provision HTTP timeout in ms (default: 15000)
 */

const axios = require('axios');

const WORKER_BASE_URL    = (process.env.WORKER_BASE_URL    || 'https://aws-testing.starsquare.in').replace(/\/$/, '');
const WORKER_COUNT       = parseInt(process.env.WORKER_COUNT,        10) || 10;
const MAX_RETRIES        = parseInt(process.env.WORKER_MAX_RETRIES,   10) || 3;
const RETRY_DELAY_MS     = parseInt(process.env.WORKER_RETRY_DELAY_MS,10) || 1000;
const HEALTH_TIMEOUT_MS  = parseInt(process.env.WORKER_HEALTH_TIMEOUT, 10) || 3000;
const DISPATCH_TIMEOUT_MS = parseInt(process.env.WORKER_DISPATCH_TIMEOUT, 10) || 15000;

function workerHealthUrl(serverIndex) {
  return `${WORKER_BASE_URL}/container-server/${serverIndex}/health`;
}

function workerProvisionUrl(serverIndex) {
  return `${WORKER_BASE_URL}/container-server/${serverIndex}/provision`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if a worker server is healthy.
 * @param {number} serverIndex 1-based server index
 * @returns {Promise<boolean>}
 */
async function checkWorkerHealth(serverIndex) {
  try {
    const response = await axios.get(workerHealthUrl(serverIndex), {
      timeout: HEALTH_TIMEOUT_MS,
    });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

/**
 * Find the first healthy worker starting from preferredIndex,
 * wrapping around all WORKER_COUNT servers.
 * @param {number} preferredIndex 1-based preferred server
 * @returns {Promise<number>} 1-based index of the first healthy server
 * @throws if no healthy server is found
 */
async function findAvailableWorker(preferredIndex) {
  for (let offset = 0; offset < WORKER_COUNT; offset++) {
    const candidate = ((preferredIndex - 1 + offset) % WORKER_COUNT) + 1;
    const healthy = await checkWorkerHealth(candidate);
    if (healthy) return candidate;
    console.warn(`[WorkerClient] ⚠️  Server ${candidate} failed health check — trying next`);
  }
  throw new Error(
    `No healthy workers available (checked ${WORKER_COUNT} servers starting from ${preferredIndex})`
  );
}

/**
 * POST a provision payload to a worker server with retry + failover.
 *
 * Strategy:
 *   1. Health-check the preferred server.
 *   2. If unhealthy, find the next healthy server (failover).
 *   3. Retry the dispatch up to MAX_RETRIES with exponential back-off.
 *   4. If all retries fail, find another failover and attempt once more.
 *
 * @param {number} preferredServerIndex 1-based preferred server
 * @param {object} payload              Provision payload
 * @param {string|number} batchId       Batch ID for logging
 * @returns {Promise<{ serverIndex: number, serverUrl: string }>}
 */
async function dispatchToWorker(preferredServerIndex, payload, batchId) {
  // Step 1 — health check preferred server
  let serverIndex = preferredServerIndex;
  const healthOk = await checkWorkerHealth(serverIndex);
  if (!healthOk) {
    console.warn(`[Batch:${batchId}] ⚠️  Preferred server ${serverIndex} unhealthy — finding failover`);
    serverIndex = await findAvailableWorker(serverIndex);
    console.log(`[Batch:${batchId}] 🔄 Routed to failover server ${serverIndex}`);
  }

  // Step 2 — dispatch with retries
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await axios.post(workerProvisionUrl(serverIndex), payload, {
        timeout: DISPATCH_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      });
      console.log(
        `[Batch:${batchId}] ✅ Dispatched ${payload.containerIdentifier} → server ${serverIndex} (attempt ${attempt})`
      );
      return { serverIndex, serverUrl: workerProvisionUrl(serverIndex) };
    } catch (err) {
      lastError = err;
      console.error(
        `[Batch:${batchId}] ❌ Dispatch attempt ${attempt}/${MAX_RETRIES} failed for ${payload.containerIdentifier} → server ${serverIndex}: ${err.message}`
      );
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt); // exponential back-off: 1s, 2s, 3s
      }
    }
  }

  // Step 3 — all retries exhausted, try next available server once
  console.warn(`[Batch:${batchId}] 🔁 All retries exhausted for server ${serverIndex}, attempting final failover...`);
  const nextIndex = (serverIndex % WORKER_COUNT) + 1;
  const failoverIndex = await findAvailableWorker(nextIndex);

  await axios.post(workerProvisionUrl(failoverIndex), payload, {
    timeout: DISPATCH_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  });
  console.log(
    `[Batch:${batchId}] ✅ Final failover dispatch successful: ${payload.containerIdentifier} → server ${failoverIndex}`
  );
  return { serverIndex: failoverIndex, serverUrl: workerProvisionUrl(failoverIndex) };
}

module.exports = { dispatchToWorker, checkWorkerHealth, findAvailableWorker, WORKER_BASE_URL, WORKER_COUNT };
