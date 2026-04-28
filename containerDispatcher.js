'use strict';

/**
 * containerDispatcher.js
 * Routes container provisioning to local exec (dev) or remote worker servers (prod).
 *
 * Dev  (NODE_ENV !== 'production'):
 *   All containers are launched locally via shell script / PowerShell, exactly as before.
 *
 * Prod (NODE_ENV === 'production'):
 *   Containers are sharded across worker servers using:
 *     serverIndex = Math.floor(containerIndex / K) + 1
 *   where K = CONTAINERS_PER_SERVER (default 50).
 *   Dispatch is HTTP POST to the remote worker with retry + failover (see workerClient.js).
 *
 * Env vars:
 *   NODE_ENV               Set to 'production' to enable remote dispatch
 *   CONTAINERS_PER_SERVER  Max containers per worker server — K (default: 50)
 *   WORKER_BASE_URL        Base URL of the worker host
 */

const path = require('path');
const { exec } = require('child_process');
const { dispatchToWorker, WORKER_BASE_URL } = require('./workerClient');

const IS_PROD = process.env.NODE_ENV === 'production';
const K       = parseInt(process.env.CONTAINERS_PER_SERVER, 10) || 50;

if (IS_PROD && !process.env.WORKER_BASE_URL) {
  console.warn('[ContainerDispatcher] ⚠️  NODE_ENV=production but WORKER_BASE_URL is not set. Remote dispatch may fail.');
}
if (!IS_PROD) {
  console.log('[ContainerDispatcher] ℹ️  Running in DEVELOPMENT mode — containers will be launched locally via exec().');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * 1-based server index for a 0-based containerIndex using bin-packing formula.
 * containers [0..K-1]   → server 1
 * containers [K..2K-1]  → server 2
 * etc.
 */
function computeServerIndex(containerIndex) {
  return Math.floor(containerIndex / K) + 1;
}

function computeServerUrl(serverIndex) {
  const base = WORKER_BASE_URL.replace(/\/$/, '');
  return `${base}/container-server/${serverIndex}`;
}

function buildProvisionPayload(container, identifier, batchId, testId) {
  return {
    containerIdentifier: identifier,
    questionId:          container.question_id,
    dockerPort:          container.docker_port,
    outputPort:          container.output_port,
    batchId,
    testId,
  };
}

// ─── Local (dev) provisioner ──────────────────────────────────────────────────

/**
 * Launch a container on the local machine via the existing shell/PS1 scripts.
 * Fire-and-forget (mirrors original behaviour).
 */
function execLocalContainer(container, identifier, batchId) {
  const isWindows  = process.platform === 'win32';
  const ext        = isWindows ? 'ps1' : 'sh';
  const framework  = 'react';
  const scriptPath = path.join(__dirname, `generate-docker-compose-${container.question_id}-${framework}.${ext}`);

  const command = isWindows
    ? `powershell.exe -ExecutionPolicy Bypass -File "${scriptPath}" -UserID 0 -EmployeeNo "${identifier}" -dockerPort ${container.docker_port} -outputPort ${container.output_port}`
    : `bash "${scriptPath}" "0" "${identifier}" "${container.docker_port}" "${container.output_port}"`;

  console.log(`[Batch:${batchId}] 🖥️  [DEV] Starting container ${identifier} (${container.question_id}) locally on ports ${container.docker_port}/${container.output_port}`);

  exec(command, (error) => {
    if (error) {
      console.error(`[Batch:${batchId}] ❌ [DEV] Local Docker start failed for ${identifier}: ${error.message}`);
    } else {
      console.log(`[Batch:${batchId}] ✅ [DEV] Container ${identifier} started locally`);
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Provision a single container — dev runs locally, prod dispatches to a worker.
 *
 * This is fire-and-forget: call without await inside the provisioning loop so
 * the HTTP response is returned immediately to the client.
 * DB server_index / server_url are updated asynchronously on success.
 *
 * @param {number}        containerIndex   0-based position in the provisioning loop
 * @param {object}        container        Row from pre_allocated_containers
 * @param {string}        identifier       Container identifier e.g. "pac42"
 * @param {string|number} batchId
 * @param {string|number} testId
 * @param {object}        db               mysql2 promise pool (con.promise()) for post-dispatch DB update
 * @returns {Promise<void>}
 */
async function dispatchContainer(containerIndex, container, identifier, batchId, testId, db) {
  if (!IS_PROD) {
    execLocalContainer(container, identifier, batchId);
    return;
  }

  const preferredIndex = computeServerIndex(containerIndex);
  const payload        = buildProvisionPayload(container, identifier, batchId, testId);

  const { serverIndex, serverUrl } = await dispatchToWorker(preferredIndex, payload, batchId);

  // Persist actual server assignment (may differ from preferred if failover occurred)
  if (db) {
    await db.query(
      'UPDATE pre_allocated_containers SET server_index = ?, server_url = ? WHERE id = ?',
      [serverIndex, serverUrl, container.id]
    );
  }
}

module.exports = { dispatchContainer, computeServerIndex, computeServerUrl, IS_PROD, K };
