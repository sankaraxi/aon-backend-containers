const express = require("express")
const cors = require("cors")
const bodyparser = require('body-parser')
const mysql=require('mysql2')
require("dotenv").config();
const path = require('path');
const app = express()
const jwt = require('jsonwebtoken');
const fs = require("fs");

const { a1l1q2 } = require("./A1L1RQ02.js");
const { a1l1q1 } = require("./A1L1RQ01.js");
const { a1l1q3 } = require('./A1L1RQ03.js');
const { calculateOverallScores } = require("./calculateOverallScores.js");
const axios = require("axios");
const { exec } = require('child_process');

app.use(bodyparser.json());
app.use(express.json())
app.use(bodyparser.json({limit: '50mb'}));
app.use(bodyparser.urlencoded({extended:true}));
app.use(express.static('public'));
const XLSX = require("xlsx");
const multer = require("multer");

const crypto = require('crypto');

// JWT config
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-prod';

const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER;
const BASIC_AUTH_PASS = process.env.BASIC_AUTH_PASS;
const CONTAINER_WORKSPACE_FOLDER = '/home/coder/project';

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

function isProductionContainerRouting() {
  const mode = (process.env.CONTAINER_ROUTING_MODE || process.env.NODE_ENV || 'development').toLowerCase();
  return mode === 'production';
}

function getContainersPerServer() {
  const parsed = Number.parseInt(
    process.env.CONTAINERS_PER_SERVER || process.env.CONTAINER_BUCKET_SIZE || '1',
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function getContainerServerNumber(containerOrdinal) {
  const ordinal = Number(containerOrdinal);
  if (!isProductionContainerRouting()) return 1;
  if (!Number.isFinite(ordinal) || ordinal < 1) return 1;
  return Math.floor((ordinal - 1) / getContainersPerServer()) + 1;
}

function applyTemplate(template, values) {
  if (!template) return null;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function buildContainerAccess({ dockerPort, outputPort, serverNumber }) {
  const resolvedServerNumber = Number(serverNumber) > 0 ? Number(serverNumber) : 1;
  const routingMode = isProductionContainerRouting() ? 'production' : 'development';

  if (isProductionContainerRouting()) {
    const serverBaseUrl = normalizeBaseUrl(process.env.CONTAINER_SERVER_BASE_URL);
    const resolvedServerBaseUrl = serverBaseUrl ? `${serverBaseUrl}/${resolvedServerNumber}` : null;
    const templateValues = {
      dockerPort,
      outputPort,
      serverNumber: resolvedServerNumber,
      serverBaseUrl: resolvedServerBaseUrl || ''
    };

    return {
      routing_mode: routingMode,
      container_server_number: resolvedServerNumber,
      container_server_base_url: resolvedServerBaseUrl,
      editor_url:
        applyTemplate(process.env.CONTAINER_EDITOR_URL_TEMPLATE, templateValues) ||
        (resolvedServerBaseUrl && dockerPort
          ? `${resolvedServerBaseUrl}/ds/${dockerPort}/?folder=${encodeURIComponent(CONTAINER_WORKSPACE_FOLDER)}`
          : null),
      preview_url:
        applyTemplate(process.env.CONTAINER_PREVIEW_URL_TEMPLATE, templateValues) ||
        (resolvedServerBaseUrl && outputPort ? `${resolvedServerBaseUrl}/out/${outputPort}` : null)
    };
  }

  const editorBaseUrl = normalizeBaseUrl(process.env.CONTAINER_EDITOR_BASE_URL || 'http://localhost');
  const previewBaseUrl = normalizeBaseUrl(process.env.CONTAINER_PREVIEW_BASE_URL || 'http://localhost');

  return {
    routing_mode: routingMode,
    container_server_number: resolvedServerNumber,
    container_server_base_url: null,
    editor_url: dockerPort ? `${editorBaseUrl}:${dockerPort}/?folder=${encodeURIComponent(CONTAINER_WORKSPACE_FOLDER)}` : null,
    preview_url: outputPort ? `${previewBaseUrl}:${outputPort}` : null
  };
}

function getContainerProvisionDispatchUrl(serverNumber) {
  const template = process.env.CONTAINER_SERVER_PROVISION_URL_TEMPLATE;
  if (!template) return null;

  return applyTemplate(template, {
    serverNumber,
    serverBaseUrl: normalizeBaseUrl(process.env.CONTAINER_SERVER_BASE_URL)
      ? `${normalizeBaseUrl(process.env.CONTAINER_SERVER_BASE_URL)}/${serverNumber}`
      : ''
  });
}

function getUrlDetails(urlString) {
  if (!urlString) {
    return {
      href: null,
      origin: null,
      pathname: null,
      search: null
    };
  }

  try {
    const parsed = new URL(urlString);
    return {
      href: parsed.href,
      origin: parsed.origin,
      pathname: parsed.pathname,
      search: parsed.search || ''
    };
  } catch {
    return {
      href: urlString,
      origin: null,
      pathname: null,
      search: null
    };
  }
}

function formatAxiosErrorDetails(error) {
  const method = error.config?.method ? String(error.config.method).toUpperCase() : 'UNKNOWN';
  const urlDetails = getUrlDetails(error.config?.url || error.response?.config?.url || null);
  const status = error.response?.status || null;
  const statusText = error.response?.statusText || null;
  const allowHeader = error.response?.headers?.allow || error.response?.headers?.Allow || null;
  const responseData = error.response?.data;

  return {
    method,
    dispatch_url: urlDetails.href,
    dispatch_origin: urlDetails.origin,
    dispatch_path: urlDetails.pathname,
    dispatch_query: urlDetails.search,
    status,
    status_text: statusText,
    allow: allowHeader,
    response_data: responseData,
    message: error.message
  };
}

function buildLocalProvisionCommand(container) {
  const isWindows = process.platform === 'win32';
  const ext = isWindows ? 'ps1' : 'sh';
  const identifier = `pac${container.id}`;
  const framework = 'react';
  const scriptPath = path.join(__dirname, `generate-docker-compose-${container.question_id}-${framework}.${ext}`);
  const command = isWindows
    ? `powershell.exe -ExecutionPolicy Bypass -File "${scriptPath}" -UserID 0 -EmployeeNo "${identifier}" -dockerPort ${container.docker_port} -outputPort ${container.output_port}`
    : `bash "${scriptPath}" "0" "${identifier}" "${container.docker_port}" "${container.output_port}"`;

  return { command, identifier, scriptPath };
}

function runContainerProvisionLocally(container) {
  const { identifier, command, scriptPath } = buildLocalProvisionCommand(container);

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject({
          identifier,
          scriptPath,
          command,
          error,
          stdout,
          stderr
        });
        return;
      }

      resolve({
        identifier,
        scriptPath,
        command,
        stdout,
        stderr
      });
    });
  });
}

function dispatchProvisionedContainer(batchId, container) {
  const { identifier } = buildLocalProvisionCommand(container);
  const access = buildContainerAccess({
    dockerPort: container.docker_port,
    outputPort: container.output_port,
    serverNumber: container.container_server_number
  });

  if (isProductionContainerRouting()) {
    const dispatchUrl = getContainerProvisionDispatchUrl(container.container_server_number);
    const dispatchUrlDetails = getUrlDetails(dispatchUrl);
    if (!dispatchUrl) {
      console.error(
        `[Batch:${batchId}] Missing CONTAINER_SERVER_PROVISION_URL_TEMPLATE for production routing of ${identifier} (server ${container.container_server_number})`
      );
      return;
    }

    const dispatchPayload = {
      batch_id: Number(batchId),
      container_id: container.id,
      container_identifier: identifier,
      question_id: container.question_id,
      docker_port: container.docker_port,
      output_port: container.output_port,
      container_server_number: container.container_server_number,
      editor_url: access.editor_url,
      preview_url: access.preview_url,
      framework: 'react'
    };

    console.log(
      `[Batch:${batchId}] Dispatching ${identifier} to container server ${container.container_server_number} via ${dispatchUrlDetails.href}`
    );
    console.log(
      `[Batch:${batchId}] Dispatch target path for ${identifier}: ${dispatchUrlDetails.pathname || 'N/A'}`
    );
    console.log(
      `[Batch:${batchId}] Target deployment endpoints for ${identifier}: editor=${access.editor_url || 'N/A'} preview=${access.preview_url || 'N/A'}`
    );

    axios.post(
      dispatchUrl,
      dispatchPayload,
      {
        timeout: Number.parseInt(process.env.CONTAINER_SERVER_DISPATCH_TIMEOUT_MS || '15000', 10)
      }
    )
      .then((response) => {
        console.log(
          `[Batch:${batchId}] Routed ${identifier} (${container.question_id}) to container server ${container.container_server_number} at ${dispatchUrlDetails.pathname || dispatchUrlDetails.href} with status ${response.status}`
        );
        if (response.data !== undefined) {
          console.log(
            `[Batch:${batchId}] Dispatch response for ${identifier}: ${JSON.stringify(response.data)}`
          );
        }
      })
      .catch((error) => {
        const details = formatAxiosErrorDetails(error);
        console.error(
          `[Batch:${batchId}] Failed to dispatch ${identifier} to container server ${container.container_server_number}: ${details.message}`
        );
        console.error(
          `[Batch:${batchId}] Dispatch failure target for ${identifier}: method=${details.method} url=${details.dispatch_url || 'N/A'} path=${details.dispatch_path || 'N/A'}`
        );
        if (details.status) {
          console.error(
            `[Batch:${batchId}] Dispatch failure response for ${identifier}: status=${details.status} statusText=${details.status_text || 'N/A'} allow=${details.allow || 'N/A'}`
          );
        }
        if (details.response_data !== undefined) {
          console.error(
            `[Batch:${batchId}] Dispatch failure body for ${identifier}: ${JSON.stringify(details.response_data)}`
          );
        }

        if (details.status === 405) {
          console.error(
            `[Batch:${batchId}] ${identifier} hit a 405 Method Not Allowed. The target server/path exists, but it is rejecting POST on ${details.dispatch_path || details.dispatch_url || 'the resolved path'}.`
          );
        }
      });
    return;
  }

  console.log(
    `[Batch:${batchId}] Starting Docker container ${identifier} (${container.question_id}) on ports ${container.docker_port}/${container.output_port}`
  );
  runContainerProvisionLocally(container)
    .then(() => {
      console.log(`[Batch:${batchId}] Container ${identifier} started`);
    })
    .catch((result) => {
      console.error(`[Batch:${batchId}] Docker start failed for ${identifier}: ${result.error.message}`);
      if (result.stderr) {
        console.error(`[Batch:${batchId}] Docker start stderr for ${identifier}: ${result.stderr}`);
      }
    });
}

app.get('/container-server/:serverNumber/health', (req, res) => {
  const serverNumber = Number(req.params.serverNumber) || 1;
  res.json({
    status: 'ok',
    server_number: serverNumber,
    routing_mode: isProductionContainerRouting() ? 'production' : 'development',
    provision_path: `/container-server/${serverNumber}/provision`
  });
});

app.post('/container-server/:serverNumber/provision', async (req, res) => {
  const serverNumber = Number(req.params.serverNumber) || 1;
  const {
    batch_id,
    container_id,
    container_identifier,
    question_id,
    docker_port,
    output_port,
    framework
  } = req.body || {};

  if (!container_id || !question_id || !docker_port || !output_port) {
    return res.status(400).json({
      error: 'container_id, question_id, docker_port, and output_port are required'
    });
  }

  const container = {
    id: container_id,
    question_id,
    docker_port,
    output_port,
    container_server_number: serverNumber
  };

  const access = buildContainerAccess({
    dockerPort: docker_port,
    outputPort: output_port,
    serverNumber
  });

  console.log(
    `[Worker:${serverNumber}] Provision request received for ${container_identifier || `pac${container_id}`} from batch ${batch_id || 'N/A'}`
  );
  console.log(
    `[Worker:${serverNumber}] Deploy path: /container-server/${serverNumber}/provision question=${question_id} framework=${framework || 'react'} docker=${docker_port} output=${output_port}`
  );
  console.log(
    `[Worker:${serverNumber}] Access URLs: editor=${access.editor_url || 'N/A'} preview=${access.preview_url || 'N/A'}`
  );

  try {
    const result = await runContainerProvisionLocally(container);
    return res.json({
      started: true,
      server_number: serverNumber,
      deploy_path: `/container-server/${serverNumber}/provision`,
      container_identifier: result.identifier,
      script_path: result.scriptPath,
      editor_url: access.editor_url,
      preview_url: access.preview_url,
      stdout: result.stdout,
      stderr: result.stderr || null
    });
  } catch (result) {
    console.error(
      `[Worker:${serverNumber}] Local provision failed for ${container_identifier || `pac${container_id}`}: ${result.error.message}`
    );
    if (result.stderr) {
      console.error(`[Worker:${serverNumber}] Local provision stderr: ${result.stderr}`);
    }

    return res.status(500).json({
      started: false,
      server_number: serverNumber,
      deploy_path: `/container-server/${serverNumber}/provision`,
      container_identifier: result.identifier,
      script_path: result.scriptPath,
      command: result.command,
      error: result.error.message,
      stdout: result.stdout || null,
      stderr: result.stderr || null
    });
  }
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or malformed' });
  }

  const token = authHeader.split(' ')[1];
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error('JWT verify error:', err);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

function basicAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Authorization header missing or not Basic' });
  }

  const base64Credentials = authHeader.split(' ')[1];
  const decoded = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = decoded.split(':');

  if (
    username !== BASIC_AUTH_USER ||
    password !== BASIC_AUTH_PASS
  ) {
    return res.status(403).json({ error: 'Invalid username or password' });
  }

  // attach minimal identity if needed later
  req.authUser = username;
  next();
}

function generateOpaqueToken() {
  return crypto.randomBytes(24).toString('hex');
}


// Database Connection for dashboard'
app.use(cors({
  origin: ['http://localhost','http://localhost:5174','http://localhost:5194', 'http://localhost:3000','http://localhost:5184', 'http://127.0.0.1:3000', 'http://192.168.252.230:5173', "http://103.174.10.211:5173", process.env.ORIGIN], 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

const con = mysql.createPool({
    host: process.env.DB_HOST,
    port: "3306",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

con.getConnection((error, connection) => {
    if (error) {
        console.error("Database connection failed:", error);
    } else {
        console.log("Database connected successfully for dashboard");
        connection.release(); // Release connection back to the pool
    }
});

// Startup migration: ensure single-tab enforcement columns + error_log table exist
(async () => {
  const migrations = [
    "ALTER TABLE launch_tokens ADD COLUMN active_tab_id VARCHAR(64) DEFAULT NULL",
    "ALTER TABLE launch_tokens ADD COLUMN tab_heartbeat_at BIGINT UNSIGNED DEFAULT NULL",
    `CREATE TABLE IF NOT EXISTS error_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      aon_id VARCHAR(100) NOT NULL,
      error_stage VARCHAR(100) NOT NULL,
      error_message TEXT NOT NULL,
      error_detail TEXT DEFAULT NULL,
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_error_aon_id (aon_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    // ---- Pre-allocated containers feature ----
    `CREATE TABLE IF NOT EXISTS assessment_batches (
      id INT NOT NULL AUTO_INCREMENT,
      batch_name VARCHAR(255) NOT NULL,
      business_id INT DEFAULT NULL,
      client_id INT NOT NULL,
      estimated_users INT NOT NULL DEFAULT 0,
      status ENUM('draft','active','completed') NOT NULL DEFAULT 'draft',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY fk_batch_client (client_id),
      KEY fk_batch_business (business_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS pre_allocated_containers (
      id INT NOT NULL AUTO_INCREMENT,
      batch_id INT NOT NULL,
      test_id BIGINT UNSIGNED NOT NULL,
      question_id VARCHAR(20) NOT NULL,
      port_slot_id INT NOT NULL,
      docker_port INT NOT NULL,
      output_port INT NOT NULL,
      container_server_number INT DEFAULT 1,
      is_assigned TINYINT(1) NOT NULL DEFAULT 0,
      aon_id VARCHAR(100) DEFAULT NULL,
      assigned_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY fk_pac_batch (batch_id),
      KEY idx_pac_client_assigned (batch_id, is_assigned)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    // New columns for Docker container tracking
    "ALTER TABLE pre_allocated_containers ADD COLUMN container_identifier VARCHAR(50) NULL",
    "ALTER TABLE pre_allocated_containers ADD COLUMN container_server_number INT DEFAULT 1",
    "ALTER TABLE pre_allocated_containers ADD COLUMN is_deprovisioned TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE launch_tokens ADD COLUMN container_server_number INT DEFAULT 1",
    // Extend batch status enum to include deprovisioned
    "ALTER TABLE assessment_batches MODIFY COLUMN status ENUM('draft','active','completed','deprovisioned') NOT NULL DEFAULT 'draft'"
  ];
  for (const sql of migrations) {
    try {
      await con.promise().query(sql);
    } catch (e) {
      if (!e.message.includes('Duplicate column name') && !e.message.includes('already exists')) {
        console.warn('Migration warning:', e.message);
      }
    }
  }
  console.log('✅ Tab enforcement columns, error_log, assessment_batches and pre_allocated_containers tables ready');
})();

module.exports = con;

// cron.schedule('*/3 * * * *', () => {
//   const sql = `UPDATE cocube_user SET log_status = 0 WHERE login_expiry < NOW() AND log_status = 1`;
//   con.query(sql, (err) => {
//     if (err) console.log("🔴 Cron cleanup failed:", err);
//     else console.log("🧹 Expired sessions cleaned up.");
//   });
// });
// Timer
// ---------- Timer Session Logic ----------
const DURATION = 30 * 60 * 1000; // 30 mins
const EXAM_DURATION_MS = DURATION;
const DEADLINE_EPOCH_THRESHOLD_MS = 1000000000000;
const sessions = {}; // sessionId => { startedAt, remainingMs }

function isDeadlineStored(rawValue) {
  if (rawValue === null || rawValue === undefined) return false;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > DEADLINE_EPOCH_THRESHOLD_MS;
}

function getRemainingMsFromStoredValue(rawValue) {
  if (rawValue === null || rawValue === undefined) return EXAM_DURATION_MS;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return EXAM_DURATION_MS;

  if (isDeadlineStored(parsed)) {
    return Math.max(0, parsed - Date.now());
  }

  return Math.max(0, parsed);
}

function getDeadlineFromStoredValue(rawValue) {
  if (isDeadlineStored(rawValue)) {
    return Number(rawValue);
  }
  const remainingMs = getRemainingMsFromStoredValue(rawValue);
  return Date.now() + remainingMs;
}

async function insertUserLogSafe(userId, activityCode) {
  if (!userId) return;
  try {
    await con.promise().query(
      "INSERT INTO user_log (userid, activity_code) VALUES (?, ?)",
      [userId, activityCode]
    );
  } catch (err) {
    console.error(`[${userId}] ❌ Failed to insert user_log activity_code=${activityCode}: ${err.message}`);
  }
}

async function insertErrorLogSafe(aonId, stage, message, detail = null) {
  if (!aonId) return;
  try {
    await con.promise().query(
      "INSERT INTO error_log (aon_id, error_stage, error_message, error_detail) VALUES (?, ?, ?, ?)",
      [String(aonId), stage, message, detail ? String(detail) : null]
    );
  } catch (err) {
    console.error(`[${aonId}] ❌ Failed to insert error_log stage=${stage}: ${err.message}`);
  }
}

async function runDockerCleanupForUser({ userId, question, framework }) {
  if (!userId || !question || !framework) {
    throw new Error("Missing userId, question, or framework for Docker cleanup");
  }

  const shScriptPath = path.join(__dirname, "cleanup-docker.sh");
  const psScriptPath = path.join(__dirname, "cleanup-docker.ps1");

  const command = process.platform === "win32"
    ? `powershell.exe -ExecutionPolicy Bypass -File "${psScriptPath}" "${question}" "${framework}" "${userId}"`
    : `bash "${shScriptPath}" "${question}" "${framework}" "${userId}"`;

  console.log(`[${userId}] 🗑️  Docker container kill initiated — question=${question}, framework=${framework}`);
  console.log(`[${userId}] 🔧 Executing cleanup command: ${command}`);

  await new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (stderr) {
        console.warn(`[${userId}] ⚠️  Docker cleanup stderr: ${stderr.trim()}`);
      }
      if (error) {
        console.error(`[${userId}] ❌ Docker cleanup exec error: ${error.message}`);
        insertErrorLogSafe(userId, 'docker_cleanup', error.message, stderr || null);
        return reject(error);
      }
      console.log(`[${userId}] ✅ Docker cleanup output:\n${stdout.trim()}`);
      resolve();
    });
  });

  console.log(`[${userId}] 🧹 Docker container killed — logging activity code 7`);
  await insertUserLogSafe(userId, 7); // Docker Container Killed
}

async function submitFinalAssessmentInternal({ aonId, framework, outputPort, userQuestion, message }) {
  if (!aonId || !framework || !userQuestion) {
    throw new Error("Missing required fields: aonId, framework, userQuestion");
  }

  const [latestTokenRows] = await con.promise().query(
    "SELECT submitted FROM launch_tokens WHERE aon_id = ? ORDER BY id DESC LIMIT 1",
    [aonId]
  );

  if (latestTokenRows.length > 0 && Number(latestTokenRows[0].submitted) === 1) {
    return {
      alreadySubmitted: true,
      detailedResults: null,
      redirectUrl: null,
    };
  }

  let results;

  if (userQuestion === "a1l1q3") {
    const { a1l1q3 } = require("./A1L1RQ03.js");
    results = await a1l1q3(aonId, framework, outputPort);
  } else if (userQuestion === "a1l1q2") {
    const { a1l1q2 } = require("./A1L1RQ02.js");
    results = await a1l1q2(aonId, framework, outputPort);
  } else if (userQuestion === "a1l1q1") {
    const { a1l1q1 } = require("./A1L1RQ01.js");
    results = await a1l1q1(aonId, framework, outputPort);
  } else {
    throw new Error("Invalid question type");
  }

  const overallResult = calculateOverallScores(results);
  const overallResultJson = JSON.stringify(overallResult);
  const resultJson = JSON.stringify(results);

  await con.promise().query(
    "INSERT INTO results (userid, result_data, overall_result) VALUES (?, ?, ?)",
    [aonId, resultJson, overallResultJson]
  );

  await con.promise().query(
    "UPDATE launch_tokens SET submitted = 1, log_status = 0, closing_time_ms = 0 WHERE aon_id = ?",
    [aonId]
  );

  // Release port_slot when test is submitted
  try {
    const [tokenSlot] = await con.promise().query(
      "SELECT port_slot_id FROM launch_tokens WHERE aon_id = ? ORDER BY id DESC LIMIT 1",
      [aonId]
    );
    if (tokenSlot.length && tokenSlot[0].port_slot_id) {
      await con.promise().query(
        "UPDATE port_slots SET is_utilized = 0 WHERE id = ?",
        [tokenSlot[0].port_slot_id]
      );
      console.log(`[${aonId}] ✅ Port slot ${tokenSlot[0].port_slot_id} released`);
    }
  } catch (e) {
    console.error(`[${aonId}] ❌ Failed to release port_slot: ${e.message}`);
    insertErrorLogSafe(aonId, 'port_slot_release', e.message);
  }

  await insertUserLogSafe(aonId, 6); // Submitted the Assessment
  console.log(`[${aonId}] 📝 Submission logged (activity code 6)`);

  let redirectUrl = null;
  try {
    const [redirectRows] = await con.promise().query(
      "SELECT redirect_url FROM external_requests WHERE aon_id = ? AND redirect_url IS NOT NULL ORDER BY id DESC LIMIT 1",
      [aonId]
    );
    if (redirectRows.length && redirectRows[0].redirect_url) {
      redirectUrl = redirectRows[0].redirect_url;
    }
  } catch (e) {
    console.error(`[${aonId}] ❌ Failed to fetch redirect_url: ${e.message}`);
    insertErrorLogSafe(aonId, 'redirect_url_fetch', e.message);
  }

  const webhookPayload = {
    userId: aonId,
    result_data: results,
    overall_result: overallResult,
    timestamp: new Date().toISOString(),
    ...(message ? { message } : {}),
  };

  try {
    const [rows] = await con.promise().query(
      "SELECT results_webhook FROM external_requests WHERE aon_id = ? AND results_webhook IS NOT NULL ORDER BY id DESC LIMIT 1",
      [aonId]
    );

    if (rows.length && rows[0].results_webhook) {
      console.log(`[${aonId}] 🔔 Sending results webhook...`);
      axios.post(
        rows[0].results_webhook,
        webhookPayload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: "Basic " + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASS}`).toString("base64"),
          },
          timeout: 5000,
        }
      )
      .then(() => {
        console.log(`[${aonId}] ✅ Webhook delivered successfully`);
      })
      .catch(err => {
        console.error(`[${aonId}] ❌ Webhook delivery failed: ${err.message}`);
        insertErrorLogSafe(aonId, 'webhook_delivery', err.message);
      });
    }
  } catch (e) {
    console.error(`[${aonId}] ❌ Failed to fetch/send results_webhook: ${e.message}`);
    insertErrorLogSafe(aonId, 'webhook_fetch', e.message);
  }

  return {
    alreadySubmitted: false,
    detailedResults: results,
    redirectUrl,
  };
}

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage });


  app.post('/v2/start', (req, res) => {
    const { sessionId } = req.body;
    console.log("sessionId",sessionId)
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    const session = sessions[sessionId];
    if (!session) {
      sessions[sessionId] = {
        startedAt: Date.now(),
        remainingMs: DURATION
      };
      return res.json({ message: 'Timer started' });
    }

    if (!session.startedAt && session.remainingMs > 0) {
      session.startedAt = Date.now();
      return res.json({ message: 'Timer resumed' });
    }

    return res.json({ message: 'Timer already running' });
  });

  app.post('/v2/pause/:userId/:sessionId/:timeLeft', (req, res) => {
  
    let sessionId;
    let timeLeft;
    let newTimeleft;
    try {
      sessionId = req.params.sessionId;
      timeLeft = req.params.timeLeft;
      newTimeleft = timeLeft*1000;
      const userId = req.params.userId;

      console.log(`[${userId}] ⏸️ Pause — sessionId=${sessionId}, timeLeft=${newTimeleft}ms`);
  
    // Store remainingMs into DB
    const updateQuery = `UPDATE cocube_user SET log_status=2, closing_time_ms = ? WHERE id = ?`;
    con.query(updateQuery, [newTimeleft, userId], (err, result) => {
      if (err) {
        console.error(`[${userId}] ❌ Pause DB update failed: ${err.message}`);
        return res.status(500).json({ error: 'Database update failed' });
      }
  
      console.log(`[${userId}] ✅ Paused — closing_time_ms set to ${newTimeleft}ms`);
      return res.json({ message: 'Paused and DB updated', remainingMs: newTimeleft });
    });

    } catch {
      return res.status(400).json({ error: 'Invalid pause data' });
    }
  
    // const session = sessions[sessionId];
    // if (!session || !session.startedAt) {
    //   return res.json({ message: 'No active timer' });
    // }
    // let newTimeleft = timeLeft*1000;
    // console.log("newTimeleft",newTimeleft)
    // const elapsed = Date.now() - session.startedAt;
    // session.remainingMs = Math.max(0, session.remainingMs - elapsed);
    // session.startedAt = null;
  
    
  });
  
  app.post('/v2/timer', (req, res) => {
    const { sessionId } = req.body;
    const session = sessions[sessionId];
    if (!session) return res.json({ remainingSeconds: 0, running: false });

    let remaining = session.remainingMs;
    if (session.startedAt) {
      const elapsed = Date.now() - session.startedAt;
      remaining = Math.max(0, session.remainingMs - elapsed);
    }

    if (remaining === 0) {
      session.startedAt = null;
      session.remainingMs = 0;
    }

    return res.json({
      remainingSeconds: Math.floor(remaining / 1000),
      running: !!session.startedAt
    });
  });

  // GET /user-log/:id
  app.get('/v2/time-left/:id', (req, res) => {
    const userId = req.params.id;
    console.log("userId triggered", userId);

    const sql = 'SELECT log_status, closing_time_ms FROM launch_tokens WHERE id = ?';

    con.query(sql, [userId], (err, result) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (result.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = result[0]; 
      const remainingMs = getRemainingMsFromStoredValue(user.closing_time_ms);
      const timerEndMs = isDeadlineStored(user.closing_time_ms)
        ? Number(user.closing_time_ms)
        : Date.now() + remainingMs;

      res.json({
        id: userId,
        log_status: user.log_status,
        closing_time_ms: remainingMs,
        timer_end_ms: timerEndMs
      });
    });
  });

    // Assuming Express is set up
  app.get('/v2/heartbeat', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Check if the candidate's dev server is reachable on the given outputPort
  app.post('/v2/check-dev-server', async (req, res) => {
    const { outputPort } = req.body;
    if (!outputPort) {
      return res.status(400).json({ running: false, error: 'outputPort is required' });
    }
    try {
      await axios.get(`http://localhost:${outputPort}`, { timeout: 3000 });
      res.json({ running: true });
    } catch (err) {
      // Any connection error means the server is not running
      res.json({ running: false });
    }
  });
  

  app.post("/v2/login",(req,res)=>{
   let{username,password}=req.body
      let loginsql='select * from cocube_user where emailid=?'
      con.query(loginsql,[username],(error,result)=>{
        if(error){
          res.send({"status":"empty_set"})
          console.log(error)
        }
        else if(result.length>0){
          let dbusername=result[0].emailid
          let dbpassword=result[0].password
          let id=result[0].id
          let role=result[0].role
          let name=result[0].name
          let question=result[0].assigned_question
          let docker_port=result[0].docker_port
          let output_port=result[0].output_port
          let empNo=result[0].employee_no
          let submitted =result[0].submitted
          if(dbusername===username && dbpassword===password){

            if (submitted === 1) {
              console.log(`[login:${id}] ⚠️  User already submitted — blocking re-login`);
              return res.send({ "status": "already_logged_in" });
            }
            
            const tokenPayload = { id, role, email: dbusername, name };
            const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '2h' });

            res.send({
              "status":"success",
              "id":id,
              "role":role,
              "name":name,
              "question":question,
              "docker_port":docker_port,
              "output_port":output_port,
              "empNo": empNo,
              "token": token
            })
            
            console.log(`[login:${id}] ✅ Login success — role=${role}, name=${name}`)
          }
          else{
            res.send({"status":"invalid_user"})
            console.log(`[login] ❌ Invalid credentials for username=${username}`)
          }
        }
        else{
          res.send({"status":"both_are_invalid"})
          console.log(`[login] ❌ User not found: username=${username}`)
        }
      })
  })

   app.post("/v2/generate-token", (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  const loginsql = 'SELECT * FROM cocube_user WHERE emailid = ?';

  con.query(loginsql, [username], (error, result) => {
    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Database error" });
    }

    if (!result || result.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const row = result[0];
    const { emailid, password: dbpassword, id, role, name } = row;

    // 🔐 Validate credentials
    if (emailid !== username || dbpassword !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // 🚫 Role check — ONLY role === 1 allowed
    if (role !== 1) {
      return res.status(403).json({
        error: "Access denied. User not authorized to generate token"
      });
    }

    // 🪙 Generate JWT
    const tokenPayload = {
      id,
      role,
      email: emailid,
      name
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, {
      expiresIn: "2h"
    });

    return res.json({ token });
  });
});

  app.post('/v2/run-Assesment', async (req, res) => {
    const { userId, framework, outputPort } = req.body;
    console.log(`[${userId}] 🏃 Run Assessment (Q3) triggered — framework=${framework}, port=${outputPort}`);
    try {
      const results = await a1l1q3(userId,framework, outputPort);
      
      res.json({ detailedResults: results });

      const overallResult = calculateOverallScores(results);
    
      var insertcategory="insert into results (userid,result_data,overall_result) values(?,?,?)"
      const newOverallResult=JSON.stringify(overallResult)
      const newresult=JSON.stringify(results)
      con.query(insertcategory,[userId , newresult, newOverallResult],(error,result)=>{
          if(error){
              console.error(`[${userId}] ❌ Results insert error: ${error.message}`)
              insertErrorLogSafe(userId, 'run_assessment_q3_save', error.message);
          }
          else{
            console.log(`[${userId}] ✅ Assessment Q3 results saved`);
          }
      var insertcategory2="insert into user_log (userid,activity_code)values(?,?)"
      con.query(insertcategory2,[userId , 5],(error,result)=>{
        if(error){
            console.error(`[${userId}] ❌ user_log insert error (code 5): ${error.message}`)
        }
        else{
          console.log(`[${userId}] 📝 Run Assessment Clicked logged (activity code 5)`)
        }
      })
      })

    } catch (error) {
      console.error(`[${userId}] ❌ Assessment Q3 error: ${error.message}`);
      insertErrorLogSafe(userId, 'run_assessment_q3', error.message);

      if (
        error.message?.includes('ERR_SOCKET_NOT_CONNECTED') ||
        error.message?.includes('localhost:5173')
      ) {
        var insertcategory="insert into user_log (userid,activity_code)values(?,?)"
        con.query(insertcategory,[userId , 5],(error,result)=>{
          if(error){
              console.error(`[${userId}] ❌ user_log insert error (code 5): ${error.message}`)
          }
          else{
            console.log(`[${userId}] 📝 Run Assessment Clicked logged (activity code 5)`)
          }
        })
        return res.status(500).json({
          error: 'Frontend application is not running on port 5173. Please start it before running the assessment.'
        });
      }

      res.status(500).json({ error: 'Failed to run assessment', details: error.message });
    }
  });

  app.post('/v2/run-Assesment-2', async (req, res) => {
    const { userId, framework, outputPort } = req.body;
    console.log(`[${userId}] 🏃 Run Assessment (Q2) triggered — framework=${framework}, port=${outputPort}`);
    try {
      const results = await a1l1q2(userId,framework, outputPort);
      res.json({ detailedResults: results });

      const overallResult = calculateOverallScores(results);

      var insertcategory="insert into results (userid,result_data,overall_result) values(?,?,?)"
      const newOverallResult=JSON.stringify(overallResult)
      const newresult=JSON.stringify(results)
      con.query(insertcategory,[userId , newresult, newOverallResult],(error,result)=>{
          if(error){
              console.error(`[${userId}] ❌ Results insert error: ${error.message}`)
              insertErrorLogSafe(userId, 'run_assessment_q2_save', error.message);
          }
          else{
            console.log(`[${userId}] ✅ Assessment Q2 results saved`);
          }
      var insertcategory2="insert into user_log (userid,activity_code)values(?,?)"
      con.query(insertcategory2,[userId , 5],(error,result)=>{
        if(error){
            console.error(`[${userId}] ❌ user_log insert error (code 5): ${error.message}`)
        }
        else{
          console.log(`[${userId}] 📝 Run Assessment Clicked logged (activity code 5)`)
        }
      })
      })
      

    } catch (error) {
      console.error(`[${userId}] ❌ Assessment Q2 error: ${error.message}`);
      insertErrorLogSafe(userId, 'run_assessment_q2', error.message);

      if (
        error.message?.includes('ERR_SOCKET_NOT_CONNECTED') ||
        error.message?.includes('localhost:5173')
      ) {
        var insertcategory="insert into user_log (userid,activity_code)values(?,?)"
        con.query(insertcategory,[userId , 5],(error,result)=>{
          if(error){
              console.error(`[${userId}] ❌ user_log insert error (code 5): ${error.message}`)
          }
          else{
            console.log(`[${userId}] 📝 Run Assessment Clicked logged (activity code 5)`)
          }
        })
        return res.status(500).json({
          error: 'Frontend application is not running on port 5173. Please start it before running the assessment.'
        });
      }

      res.status(500).json({ error: 'Failed to run assessment', details: error.message });
    }
  });

  app.post('/v2/run-Assesment-1', async (req, res) => {
    const { userId, framework, outputPort } = req.body;
    console.log(`[${userId}] 🏃 Run Assessment (Q1) triggered — framework=${framework}, port=${outputPort}`);
    try {
      const results = await a1l1q1(userId,framework, outputPort);
      res.json({ detailedResults: results });
      
      const overallResult = calculateOverallScores(results);
      var insertcategory="insert into results (userid, result_data, overall_result) values(?,?,?)"
      const newOverallResult=JSON.stringify(overallResult)
      const newresult=JSON.stringify(results)
      con.query(insertcategory,[userId, newresult, newOverallResult],(error,result)=>{
          if(error){
              console.error(`[${userId}] ❌ Results insert error: ${error.message}`)
              insertErrorLogSafe(userId, 'run_assessment_q1_save', error.message);
          }
          else{
            console.log(`[${userId}] ✅ Assessment Q1 results saved`);
          }
      var insertcategory="insert into user_log (userid,activity_code)values(?,?)"
      con.query(insertcategory,[userId , 5],(error,result)=>{
        if(error){
            console.error(`[${userId}] ❌ user_log insert error (code 5): ${error.message}`)
        }
        else{
          console.log(`[${userId}] 📝 Run Assessment Clicked logged (activity code 5)`)
        }
      })
      })
      

    } catch (error) {
      console.error(`[${userId}] ❌ Assessment Q1 error: ${error.message}`);
      insertErrorLogSafe(userId, 'run_assessment_q1', error.message);

      if (
        error.message?.includes('ERR_SOCKET_NOT_CONNECTED') ||
        error.message?.includes('localhost:5173')
      ) {
        var insertcategory="insert into user_log (userid,activity_code)values(?,?)"
        con.query(insertcategory,[userId , 5],(error,result)=>{
          if(error){
              console.error(`[${userId}] ❌ user_log insert error (code 5): ${error.message}`)
          }
          else{
            console.log(`[${userId}] 📝 Run Assessment Clicked logged (activity code 5)`)
          }
        })
        return res.status(500).json({
          error: 'Frontend application is not running on port 5173. Please start it before running the assessment.'
        });
      }

      res.status(500).json({ error: 'Failed to run assessment', details: error.message });
    }
  });

  app.post("/v2/run-script", async (req, res) => {

    const { userId, empNo, userName, question, framework, dockerPort, outputPort } = req.body;

    // Log activity code 2 (Guidelines acknowledged)
    const insertQuery1 = "INSERT INTO user_log (userid, activity_code) VALUES (?, ?)";
    con.query(insertQuery1, [empNo, 2], (insertError) => {
      if (insertError) {
        console.error(`[${empNo}] 🔴 DB Insert Error (activity_code=2): ${insertError.message}`);
      } else {
        console.log(`[${empNo}] 📝 Guidelines acknowledged and proceeded to next page (activity code 2)`);
      }
    });

    // Check if this user was assigned a pre-allocated container — if so, skip script (container already running)
    const [pacRows] = await con.promise().query(
      `SELECT id, container_identifier FROM pre_allocated_containers WHERE aon_id = ? AND is_assigned = 1 AND is_deprovisioned = 0 LIMIT 1`,
      [empNo]
    );

    if (pacRows.length) {
      console.log(`[${empNo}] ⚡ Pre-allocated container already running (${pacRows[0].container_identifier}) — skipping script execution`);

      // Log activity code 3 (Docker Container Created/Ready)
      con.query("INSERT INTO user_log (userid, activity_code) VALUES (?, ?)", [empNo, 3], () => {});

      // Update user timestamps
      const issuedAt = new Date();
      const expiresAt = new Date(Date.now() + 40 * 60 * 1000);
      con.query(
        "UPDATE cocube_user SET last_login = ?, login_expiry = ? WHERE id = ?",
        [issuedAt, expiresAt, userId],
        (updateError) => {
          if (updateError) {
            console.error(`[${empNo}] 🔴 DB Update Error (user timestamps): ${updateError.message}`);
            return res.status(500).json({ status: "error", message: "User update failed" });
          }
          console.log(`[${empNo}] 🟢 Pre-allocated container ready — user timestamps updated`);
          return res.status(200).json({
            status: "success",
            output: "Pre-allocated container already running",
            pre_allocated: true
          });
        }
      );
      return;
    }

    // No pre-allocated container — run the docker-compose script as normal
    // Detect OS
    const isWindows = process.platform === "win32";
    const extension = isWindows ? "ps1" : "sh";

    // Script path
    const scriptPath = path.join(
      __dirname,
      `generate-docker-compose-${question}-${framework}.${extension}`
    );

    // Build command
    const command = isWindows
      ? `powershell.exe -ExecutionPolicy Bypass -File "${scriptPath}" -UserID ${userId} -EmployeeNo "${empNo}" -dockerPort ${dockerPort} -outputPort ${outputPort}`
      : `bash "${scriptPath}" "${userId}" "${empNo}" "${dockerPort}" "${outputPort}"`;

    console.log(`[${empNo}] 🐳 Docker container creation initiated — question=${question}, framework=${framework}`);
    console.log(`[${empNo}] 📦 Docker port: ${dockerPort}, Output port: ${outputPort}`);
    console.log(`[${empNo}] 🔧 Script path: ${scriptPath}`);
    console.log(`[${empNo}] 🚀 Executing: ${command}`);

    exec(command, (error, stdout, stderr) => {

      if (error) {
        console.error(`[${empNo}] ❌ Docker container creation failed: ${error.message}`);
        insertErrorLogSafe(empNo, 'docker_create', error.message, stderr || null);
        return res.status(500).json({
          status: "error",
          message: "Script execution failed",
          error: error.message
        });
      }

      if (stderr) {
        console.warn(`[${empNo}] ⚠️  Docker create stderr: ${stderr.trim()}`);
      }

      console.log(`[${empNo}] ✅ Docker creation output:\n${stdout.trim()}`);

      // Insert log: Docker Container Created (code 3)
      const insertQuery =
        "INSERT INTO user_log (userid, activity_code) VALUES (?, ?)";

      con.query(insertQuery, [empNo, 3], (insertError) => {

        if (insertError) {
          console.error(`[${empNo}] 🔴 DB Insert Error (activity_code=3): ${insertError.message}`);
          return res.status(500).json({
            status: "error",
            message: "Activity log insert failed"
          });
        }

        console.log(`[${empNo}] 📝 Docker Container Created logged (activity code 3)`);

        // Update user timestamps
        const updateQuery =
          "UPDATE cocube_user SET last_login = ?, login_expiry = ? WHERE id = ?";

        const issuedAt = new Date();
        const expiresAt = new Date(Date.now() + 40 * 60 * 1000);

        con.query(updateQuery, [issuedAt, expiresAt, userId], (updateError) => {

          if (updateError) {
            console.error(`[${empNo}] 🔴 DB Update Error (user timestamps): ${updateError.message}`);
            return res.status(500).json({
              status: "error",
              message: "User update failed"
            });
          }

          console.log(`[${empNo}] 🟢 Docker container is up and ready — user timestamps updated`);

          return res.status(200).json({
            status: "success",
            output: stdout,
            script: scriptPath
          });

        });

      });

    });

  });

  app.post('/v2/cleanup-docker', async (req, res) => {
    const { userId, question, framework } = req.body;

    if (!userId || !question || !framework) {
      return res.status(400).json({ error: 'userId, question, and framework are required' });
    }

    try {
      await runDockerCleanupForUser({ userId, question, framework });
      return res.json({ message: 'Docker environment cleaned up successfully.' });
    } catch (err) {
      console.error("Unexpected Error in Cleanup:", err);
      return res.status(500).json({ error: 'Failed to clean Docker.' });
    }
  });

  app.post('/v2/cleanup-docker-2', async (req, res) => {
    const { userId, question, framework } = req.body;
  
    // Validate userId
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
  
    try {
      if (question && framework) {
        await runDockerCleanupForUser({ userId, question, framework });
      } else {
        await insertUserLogSafe(userId, 7);
      }

      return res.status(200).json({ status: 'success', message: 'Docker cleanup completed' });
    } catch (err) {
      console.error('Failed to clean Docker:', err);
      return res.status(500).json({ error: 'Failed to clean Docker.' });
    }
  });

  app.get('/v2/results', basicAuth, (req, res) => {


    const sql = 'SELECT * FROM results ORDER BY result_time DESC';
    con.query(sql, (err, result) => {
        if (err) {
            console.error('Error fetching question:', err);
            return res.status(500).json({ error: 'Database query error' });
        }
        if (result.length === 0) {
            return res.status(404).json({ message: 'Question not found' });
        }
        res.json({ results: result });
    });
  
  
  });
  
  app.get('/v2/results/:id', basicAuth, (req, res) => {
  
      const id = req.params.id; // Get the ID from the request parameters
  
      const sql = 'SELECT * FROM results WHERE userid = ? ORDER BY result_time DESC';
      con.query(sql, [id], (err, result) => {
          if (err) {
              console.error('Error fetching question:', err);
              return res.status(500).json({ error: 'Database query error' });
          }
          if (result.length === 0) {
              return res.status(404).json({ message: 'Question not found' });
          }
          res.json({ results: result });
      });
    
  
  });

  app.post('/v2/logout', async (req, res) => {
    const { userId } = req.body;

    // Validate userId
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    try {
      console.log(`[logout:${userId}] 🚪 Logout request received`);
      // Send success response
      res.status(200).json({ status: 'success', message: 'logged out' });
    } catch (err) {
      console.error(`[logout:${userId}] ❌ Logout failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to logout' });
    }
  });
  
  app.post('/v2/candidate', async (req, res) => {
    const { userId, name, employeeNo } = req.body;
  
    if (!userId || !name || !employeeNo) {
      return res.status(400).json({ error: 'All fields are required' });
    }
  
    try {
      // Check if userId or employeeNo already exists
      const checkQuery = 'SELECT * FROM userreference WHERE employeeNo = ?';
      const [existingUsers] = await con.promise().query(checkQuery, [employeeNo]);
  
      if (existingUsers.length > 0) {
        return res.status(409).json({ error: 'User with this ID or Employee Number already exists' });
      }
  
      // Insert new user if no duplicates found
      const insertQuery = 'INSERT INTO userreference (userId, name, employeeNo) VALUES (?, ?, ?)';
      const [result] = await con.promise().query(insertQuery, [userId, name, employeeNo]);

      var updateQuery = 'UPDATE cocube_user SET log_status = 1 WHERE id = ?';
          con.query(updateQuery,[id],(error,result)=>{
            if(error){
                console.log(error)
                // res.send({"status":"error"})

            }
            else{
              console.log("updated")
              //  res.send({"status":"inserted"})
            }
        })
  
      res.status(201).json({ message: 'Candidate data saved successfully', id: result.insertId });
    } catch (err) {
      console.error('Error saving candidate data:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });


//Test Module Admin

// Add test
app.post("/v2/tests", (req, res) => {
  const { test_name, description, duration, date, start_time, end_time, status } = req.body;

  const sql = `
    INSERT INTO tests (test_name, description, duration, date, start_time, end_time, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  con.query(
    sql,
    [test_name, description, duration, date, start_time, end_time, status || "Active"],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error inserting test");
      }
      res.status(200).send({ message: "Test created successfully", id: result.insertId });
    }
  );
});

// Get test details
  app.get("/v2/test-details", (req, res) => {
  const sql = `
    SELECT 
      t.id AS test_id,
      t.test_name AS testName,
      COUNT(tau.aon_id) AS assigned, 
      COALESCE(SUM(CASE WHEN tau.status = 'Used' THEN 1 ELSE 0 END), 0) AS used,
      COALESCE(SUM(CASE WHEN tau.status = 'Assigned' THEN 1 ELSE 0 END), 0) AS unused,
      t.status
    FROM tests t
    LEFT JOIN test_assignment_users tau ON t.id = tau.test_id
    GROUP BY t.id, t.test_name, t.status;
  `;

  con.query(sql, (err, results) => {
    if (err) {
      console.error("❌ Error fetching test details:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results);
  });
});

const uploaduser = multer({ dest: "uploads/" });


app.post("/v2/assign-users", uploaduser.single("file"), (req, res) => {
  const { testId } = req.body;
  if (!testId || !req.file) {
    return res.status(400).json({ message: "test_id and Excel file are required" });
  }

  const XLSX = require("xlsx");
  const workbook = XLSX.readFile(req.file.path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const aon_ids = rows.slice(1).map(r => r[0]).filter(Boolean);
  if (aon_ids.length === 0) {
    return res.status(400).json({ message: "No AON IDs found in Excel file" });
  }

  // Step 1: Get remaining license
  con.query(
    "SELECT remaining_license FROM license_track ORDER BY id DESC LIMIT 1",
    (err, licenseResult) => {
      if (err) return res.status(500).json({ message: "Database error" });

      const availableLicense = licenseResult.length > 0 ? licenseResult[0].remaining_license : 0;
      const overdue = aon_ids.length > availableLicense ? aon_ids.length - availableLicense : 0;

      // Step 2: Check duplicates across ALL tests
      con.query(
        `SELECT tau.aon_id, t.test_name, t.id AS test_id
         FROM test_assignment_users tau 
         JOIN tests t ON tau.test_id = t.id
         WHERE tau.aon_id IN (?)`,
        [aon_ids],
        (err, existingRows) => {
          if (err) return res.status(500).json({ message: "Database error" });

          const duplicates = existingRows.map(row => ({
            aon_id: row.aon_id,
            test_name: row.test_name,
            test_link: `http://localhost:5001/api/${row.test_id}/${row.aon_id}`
          }));

          const existingIds = duplicates.map(d => d.aon_id);
          const newIds = aon_ids.filter(id => !existingIds.includes(id));

          if (newIds.length === 0) {
            return res.status(200).json({
              message: "No new users to assign (all duplicates across tests)",
              skipped: duplicates
            });
          }

          // Step 3: Insert new IDs
          const values = newIds.map(aon_id => [testId, aon_id, "Assigned"]);
          con.query(
            "INSERT INTO test_assignment_users (test_id, aon_id, status) VALUES ?",
            [values],
            (err, result) => {
              if (err) return res.status(500).json({ message: "Database insert error" });

              con.query("SELECT test_name FROM tests WHERE id = ?", [testId], async (err3, testRes) => {
                if (err3 || testRes.length === 0) {
                  return res.status(500).json({ message: "Failed to fetch test name" });
                }

                const testName = testRes[0].test_name;

                // Build inserted user JSON
                const newUsers = newIds.map(aon_id => ({
                  aon_id,
                  test_name: testName,
                  test_id:testId,
                  test_link: `http://localhost:5001/api/${testId}/${aon_id}`
                }));

                // Step 4: Update license
                con.query(
                  `UPDATE license_track 
                   SET remaining_license = remaining_license - ? 
                   WHERE id = (SELECT id FROM (SELECT id FROM license_track ORDER BY id DESC LIMIT 1) t)`,
                  [newIds.length],
                  async (err2) => {
                    if (err2) return res.status(500).json({ message: "License update failed" });

                    // 🔹 Log JSON in backend
                    console.log("Inserted Users JSON:", JSON.stringify(newUsers, null, 2));

                    // 🔹 Forward JSON to another API
                    try {
                      const forwardRes = await axios.post("http://192.168.252.254:3000/api/app/kggeniuslabs_registration", newUsers);
                      console.log("Forwarded successfully:", forwardRes.data);
                    } catch (fwdErr) {
                      console.error("Error forwarding JSON:", fwdErr.message);
                    }

                    res.json({
                      message: `✅ ${result.affectedRows} users assigned, ❌ ${duplicates.length} skipped${overdue > 0 ? `, ⚠️ Overdue by ${overdue} licenses` : ""}`,
                      inserted: newUsers,
                      skipped: duplicates,
                      overdue
                    });
                  }
                );
              });
            }
          );
        }
      );
    }
  );
});

// External API: accept payload from other server and assign a random test
app.post('/v2/external/assign',basicAuth, async (req, res) => {
  const payload = req.body || {};
    const { session_id, aon_id, redirect_url, results_webhook, user_metadata, client_id } = payload;

    if (!session_id || !aon_id) {
      return res.status(400).json({ error: 'Missing required fields: session_id or aon_id' });
    }

    // CHECK: Reject if aon_id already has ANY launch token (submitted OR still active).
    try {
      const [existingTokens] = await con.promise().query(
        `SELECT lt.token, lt.expires_at, lt.submitted,
                (SELECT tau.test_link FROM test_assignment_users tau 
                 WHERE tau.aon_id COLLATE utf8mb4_general_ci = lt.aon_id COLLATE utf8mb4_general_ci
                 AND tau.session_id COLLATE utf8mb4_general_ci = lt.session_id COLLATE utf8mb4_general_ci
                 LIMIT 1) AS test_link
         FROM launch_tokens lt
         WHERE lt.aon_id COLLATE utf8mb4_general_ci = ? COLLATE utf8mb4_general_ci
         ORDER BY lt.id DESC LIMIT 1`,
        [aon_id]
      );

      if (existingTokens.length > 0) {
        const token = existingTokens[0];
        if (Number(token.submitted) === 1) {
          console.warn(`[${aon_id}] ⚠️  Test link request rejected — assessment already submitted`);
          return res.status(409).json({
            error: 'Assessment already submitted for this aon_id',
            message: 'This candidate has already completed and submitted the assessment.',
            existing_link: token.test_link || null
          });
        }
        console.warn(`[${aon_id}] ⚠️  Test link request rejected — active link already exists`);
        return res.status(409).json({ 
          error: 'Test link already assigned for this aon_id',
          message: 'A test link has already been generated for this candidate. Each aon_id can only have one active test link.',
          existing_link: token.test_link || null
        });
      }
    } catch (e) {
      console.warn(`[${aon_id}] ⚠️  Check for existing token failed: ${e.message}`);
    }

    // log request (non-blocking)
    try {
      await con.promise().query(
        `INSERT INTO external_requests 
        (session_id, aon_id, redirect_url, results_webhook, user_metadata)
        VALUES (?, ?, ?, ?, ?)`,
        [
          session_id,
          aon_id,
          redirect_url || null,
          results_webhook || null,
          JSON.stringify(user_metadata || {})
        ]
      );
      console.log(`[${aon_id}] 📥 External request recorded`);
    } catch (e) {
      console.warn(`[${aon_id}] ⚠️  external_requests insert failed: ${e.message}`);
    }

    let connection;

    try {
      connection = await con.promise().getConnection();
      await connection.beginTransaction();

      // 1️⃣ Resolve client
      let resolvedClientId = null;
      let selectedQuestion = null;
      let selectedQuestionName = null;
      let businessId = null;

      if (client_id) {
        const [clientCheck] = await connection.query(
          `SELECT c.client_id, c.client_name, c.business_id FROM clients c WHERE c.client_id = ? OR c.client_code = ?`,
          [client_id, client_id]
        );

        if (!clientCheck.length) {
          throw new Error(`Client not found: ${client_id}`);
        }

        resolvedClientId = clientCheck[0].client_id;
        businessId = clientCheck[0].business_id;
        console.log(`[${aon_id}] 🏢 Using client: ${clientCheck[0].client_name} (ID: ${resolvedClientId})`);

        // Check business subscription limit
        if (businessId) {
          const [bizRows] = await connection.query(
            `SELECT business_name, subscription_limit, subscription_used FROM businesses WHERE business_id = ? FOR UPDATE`,
            [businessId]
          );
          if (bizRows.length) {
            const biz = bizRows[0];
            if (biz.subscription_limit > 0 && biz.subscription_used >= biz.subscription_limit) {
              throw new Error(`Subscription limit reached for business: ${biz.business_name}. Used ${biz.subscription_used}/${biz.subscription_limit}`);
            }
          }
        }
      }

      // 2️⃣ Try to assign a pre-allocated container (ordered by latest test_id then by id ASC)
      let test = null;
      let portSlot = null;
      let portSlotAlreadyUtilized = false;

      if (resolvedClientId) {
        // Check if there is an active batch for this client
        const [activeBatches] = await connection.query(
          `SELECT id, batch_name FROM assessment_batches WHERE client_id = ? AND status = 'active' LIMIT 1`,
          [resolvedClientId]
        );

        if (activeBatches.length) {
          // Active batch exists — ONLY assign from it; do NOT fall back to random
          const activeBatchId = activeBatches[0].id;

          const [pacRows] = await connection.query(
            `SELECT pac.id, pac.batch_id, pac.test_id, pac.question_id,
                    pac.port_slot_id, pac.docker_port, pac.output_port, pac.container_server_number
             FROM pre_allocated_containers pac
             WHERE pac.batch_id = ? AND pac.is_assigned = 0 AND pac.is_deprovisioned = 0
             ORDER BY pac.test_id DESC, pac.id ASC
             LIMIT 1 FOR UPDATE`,
            [activeBatchId]
          );

          if (!pacRows.length) {
            await connection.rollback();
            return res.status(503).json({
              error: 'No slots available',
              message: `All ${activeBatches[0].batch_name} container slots are full. No test link can be assigned at this time.`
            });
          }

          const pac = pacRows[0];
          selectedQuestion = pac.question_id;
          portSlot = {
            id: pac.port_slot_id,
            docker_port: pac.docker_port,
            output_port: pac.output_port,
            container_server_number: pac.container_server_number || 1
          };
          portSlotAlreadyUtilized = true; // port_slot was marked utilized at provision time

          // Validate stored test_id is still active; fall back to latest active test if not
          const [testCheck] = await connection.query(
            `SELECT id, test_name FROM tests WHERE id = ? AND status = 'Active' LIMIT 1`,
            [pac.test_id]
          );
          if (testCheck.length) {
            test = testCheck[0];
            console.log(`[${aon_id}] ✅ Pre-allocated container #${pac.id} assigned — test: "${test.test_name}" question: ${selectedQuestion}`);
          } else {
            const [latestTests] = await connection.query(
              `SELECT id, test_name FROM tests WHERE status = 'Active' ORDER BY id DESC LIMIT 1`
            );
            if (!latestTests.length) throw new Error('No active tests available');
            test = latestTests[0];
            console.log(`[${aon_id}] ⚠️  Container test_id ${pac.test_id} inactive — using latest test "${test.test_name}"`);
          }

          // Mark pre-allocated container as assigned
          await connection.query(
            `UPDATE pre_allocated_containers SET is_assigned = 1, aon_id = ?, assigned_at = NOW() WHERE id = ?`,
            [aon_id, pac.id]
          );
        }
        // No active batch → fall through to standard random assignment below
      }

      // 3️⃣ Fallback: pick test / question / port_slot when no pre-allocated container was found
      if (!test) {
        const [tests] = await connection.query(
          `SELECT id, test_name FROM tests WHERE status = 'Active' ORDER BY RAND() LIMIT 1`
        );
        if (!tests.length) throw new Error('No active tests available');
        test = tests[0];
      }

      if (!selectedQuestion) {
        if (resolvedClientId) {
          const [questions] = await connection.query(
            `SELECT cq.question_id, aq.question_name
             FROM client_questions cq
             JOIN assessment_questions aq ON cq.question_id = aq.question_id
             WHERE cq.client_id = ? AND cq.is_active = 1
             ORDER BY RAND() LIMIT 1`,
            [resolvedClientId]
          );
          if (!questions.length) {
            throw new Error(`No questions assigned to client: ${client_id}. Please assign questions first.`);
          }
          selectedQuestion = questions[0].question_id;
          selectedQuestionName = questions[0].question_name;
        } else {
          const [questions] = await connection.query(
            `SELECT question_id FROM assessment_questions WHERE is_active = 1 ORDER BY RAND() LIMIT 1`
          );
          selectedQuestion = questions.length ? questions[0].question_id : 'a1l1q1';
        }
      }

      console.log(`[${aon_id}] 📋 Question: ${selectedQuestion}`);

      // Increment subscription usage
      if (resolvedClientId && businessId) {
        await connection.query(
          `UPDATE businesses SET subscription_used = subscription_used + 1 WHERE business_id = ?`,
          [businessId]
        );
      }

      if (!portSlot) {
        // Pick next free port_slot in order (lowest id first)
        const [portSlots] = await connection.query(
          `SELECT id, docker_port, output_port FROM port_slots WHERE is_utilized = 0 ORDER BY id ASC LIMIT 1 FOR UPDATE`
        );
        if (!portSlots.length) throw new Error('No free port slots available');
        portSlot = { ...portSlots[0], container_server_number: 1 };
      }

      const launchToken = generateOpaqueToken();

      // 4️⃣ insert launch token with port_slot_id and question_id
      await connection.query(
        `INSERT INTO launch_tokens
        (token, session_id, aon_id, test_id, port_slot_id, question_id, container_server_number, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 3 HOUR))`,
        [launchToken, session_id, aon_id, test.id, portSlot.id, selectedQuestion, portSlot.container_server_number || 1]
      );

      // 5️⃣ mark port_slot as utilized (skipped for pre-allocated containers already marked at provision time)
      if (!portSlotAlreadyUtilized) {
        await connection.query(
          `UPDATE port_slots SET is_utilized = 1 WHERE id = ?`,
          [portSlot.id]
        );
      }

      // 6️⃣ commit transaction
      await connection.commit();

      const test_link = `${process.env.TEST_LINK}/aon/start?t=${launchToken}`;

      // non-transactional insert (safe after commit)
      await con.promise().query(
        `INSERT INTO test_assignment_users
        (test_id, aon_id, status, session_id, test_link, client_id)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [test.id, aon_id, 'Assigned', session_id, test_link, client_id || null]
      );

      // Log: Created Test Link (code 1)
      await insertUserLogSafe(aon_id, 1);
      console.log(`[${aon_id}] ✅ Test link created: ${test_link}`);

      return res.json({
        aon_id,
        session_id,
        test_id: selectedQuestion,
        test_name: selectedQuestionName,
        test_link,
        client_id: client_id || null
      });

    } catch (err) {
      if (connection) await connection.rollback();
      console.error(`[${aon_id}] ❌ External assign error: ${err.message}`);
      insertErrorLogSafe(aon_id, 'test_link_creation', err.message);
      return res.status(500).json({
        error: 'Failed to assign test',
        details: err.message
      });
    } finally {
      if (connection) connection.release();
    }
});

app.get("/v2/aon/resolve", async (req, res) => {
   const { t } = req.query;

    if (!t) {
      return res.status(400).json({ success: false, error: "Missing token" });
    }

    const [rows] = await con.promise().query(
      `
      SELECT
        lt.id,
        lt.session_id,
        lt.aon_id,
        lt.test_id,
        lt.log_status,
        lt.closing_time_ms,
        lt.assessment_started,
        lt.workspace_url,
        lt.framework,
        lt.submitted,
        lt.container_server_number,
        t.test_name,

        lt.question_id,
        ps.docker_port,
        ps.output_port,

        (SELECT er.redirect_url
         FROM external_requests er
         WHERE er.aon_id = lt.aon_id
           AND er.redirect_url IS NOT NULL
         ORDER BY er.id DESC
         LIMIT 1) AS redirect_url

      FROM launch_tokens lt
      INNER JOIN tests t
        ON t.id = lt.test_id
      LEFT JOIN port_slots ps
        ON ps.id = lt.port_slot_id
      LEFT JOIN candidate_port_slots cps
        ON cps.id = lt.slot_id

      WHERE lt.token = ?
      `,
      [t]
    );

    if (!rows.length) {
      return res.json({ success: false, message: 'Token not found' });
    }

    // // optional: one-time-use token (recommended)
    // await con.promise().query(
    //   `DELETE FROM launch_tokens WHERE token = ?`,
    //   [t]
    // );

    const payload = {
      ...rows[0],
      ...buildContainerAccess({
        dockerPort: rows[0].docker_port,
        outputPort: rows[0].output_port,
        serverNumber: rows[0].container_server_number || 1
      })
    };

    return res.json({
      success: true,
      payload
    });
  });

  // Candidate acknowledges instructions and proceeds to the assessment
  app.post("/v2/aon/acknowledge", async (req, res) => {
    const { aonId } = req.body;

    if (!aonId) {
      return res.status(400).json({ success: false, error: "Missing aonId" });
    }

    try {
      await insertUserLogSafe(aonId, 2); // Acknowledged and Proceeded
      console.log(`[${aonId}] ✅ Candidate acknowledged and proceeded`);
      return res.json({ success: true, message: "Acknowledgement recorded" });
    } catch (err) {
      console.error(`[${aonId}] ❌ Acknowledge log failed: ${err.message}`);
      insertErrorLogSafe(aonId, 'acknowledge', err.message);
      return res.status(500).json({ success: false, error: "Failed to record acknowledgement" });
    }
  });

    // Track when user starts the workspace/assessment
    
  app.post("/v2/aon/start-workspace", async (req, res) => {
    const { launchTokenId, workspaceUrl, framework } = req.body;

    if (!launchTokenId) {
      return res.status(400).json({ success: false, error: "Missing launchTokenId" });
    }

    try {
      const [rows] = await con.promise().query(
        `SELECT aon_id, closing_time_ms FROM launch_tokens WHERE id = ? LIMIT 1`,
        [launchTokenId]
      );

      if (!rows.length) {
        return res.status(404).json({ success: false, error: "Invalid launchTokenId" });
      }

      const aonId = rows[0].aon_id;
      const deadlineMs = getDeadlineFromStoredValue(rows[0].closing_time_ms);

      console.log(`[${aonId}] 🖥️  Workspace started — framework=${framework}, url=${workspaceUrl || 'N/A'}`);

      await con.promise().query(
        `UPDATE launch_tokens 
         SET assessment_started = 1, 
             workspace_url = ?, 
             framework = ?,
             log_status = 1,
             closing_time_ms = ?
         WHERE id = ?`,
        [workspaceUrl || null, framework || null, deadlineMs, launchTokenId]
      );

      await insertUserLogSafe(aonId, 4); // Started the Assessment
      console.log(`[${aonId}] 📝 Assessment started logged (activity code 4)`);

      return res.json({ success: true, message: "Workspace started tracking updated" });
    } catch (err) {
      console.error(`[launchTokenId:${launchTokenId}] ❌ Error updating workspace start: ${err.message}`);
      return res.status(500).json({ success: false, error: "Database update failed" });
    }
  });

  // Pause timer and save remaining time for launch token
  app.post('/v2/aon/pause-timer/:launchTokenId/:timeLeft', (req, res) => {
    const { launchTokenId } = req.params;

    con.query(
      `SELECT closing_time_ms FROM launch_tokens WHERE id = ? LIMIT 1`,
      [launchTokenId],
      (err, rows) => {
        if (err) {
          console.error("❌ DB read failed:", err);
          return res.status(500).json({ error: 'Database read failed' });
        }

        if (!rows.length) {
          return res.status(404).json({ error: 'Launch token not found' });
        }

        const deadlineMs = getDeadlineFromStoredValue(rows[0].closing_time_ms);
        const remainingMs = Math.max(0, deadlineMs - Date.now());

        con.query(
          `UPDATE launch_tokens SET log_status = 1, closing_time_ms = ? WHERE id = ?`,
          [deadlineMs, launchTokenId],
          (updateErr) => {
            if (updateErr) {
              console.error("❌ DB update failed:", updateErr);
              return res.status(500).json({ error: 'Database update failed' });
            }

            return res.json({
              message: 'Timer continues in background; no pause applied',
              remainingMs,
            });
          }
        );
      }
    );
  });

  // Submit final assessment and send webhook
  app.post('/v2/submit-final', async (req, res) => {
    console.log('🚀 Received final submission');
    const { aonId, framework, outputPort, userQuestion, autoSubmit, reason } = req.body;

    if (!aonId || !framework || !userQuestion) {
      return res.status(400).json({ error: 'Missing required fields: aonId, framework, userQuestion' });
    }

    // Build a precise message for the webhook based on the trigger reason
    let autoSubmitMessage;
    if (autoSubmit) {
      switch (reason) {
        case 'tab_switch':
          autoSubmitMessage = 'The candidate was auto-submitted due to repeated tab switching (assessment integrity violation). Development server was running at the time of submission.';
          break;
        case 'timer_expired':
        default:
          autoSubmitMessage = 'The candidate exceeded the allotted time and the assessment was submitted automatically. Development server was running at the time of submission.';
      }
    }

    try {
      const submission = await submitFinalAssessmentInternal({
        aonId,
        framework,
        outputPort,
        userQuestion,
        message: autoSubmitMessage,
      });

      return res.json({
        success: true, 
        message: submission.alreadySubmitted ? 'Assessment already submitted' : 'Assessment submitted successfully',
        detailedResults: submission.detailedResults,
        redirect_url: submission.redirectUrl 
      });

    } catch (error) {
      console.error('Final submission error:', error);

      // Check if the error is because dev server is not running
      const isDevServerDown = error.message && (
        error.message.includes('ERR_EMPTY_RESPONSE') ||
        error.message.includes('ERR_CONNECTION_REFUSED') ||
        error.message.includes('ERR_SOCKET_NOT_CONNECTED') ||
        error.message.includes('localhost:5173') ||
        error.message.includes('net::ERR_')
      );

      if (isDevServerDown) {
        return res.status(200).json({
          success: false,
          devServerNotRunning: true,
          message: 'Development server is not running. Please follow the guidelines to start your application before submitting.'
        });
      }

      return res.status(500).json({ error: 'Failed to submit assessment', details: error.message });
    }
  });

   // ========== CLIENT MANAGEMENT API ENDPOINTS ==========

  // Get all clients
  app.get('/v2/clients', async (req, res) => {
    try {
      const [clients] = await con.promise().query(
        'SELECT * FROM clients ORDER BY client_name'
      );
      res.json(clients);
    } catch (err) {
      console.error('Error fetching clients:', err);
      res.status(500).json({ error: 'Failed to fetch clients' });
    }
  });

  // Add a new client
  app.post('/v2/clients', async (req, res) => {
    const { client_name, client_code, description } = req.body;

    if (!client_name || !client_code) {
      return res.status(400).json({ error: 'client_name and client_code are required' });
    }

    try {
      const [existing] = await con.promise().query(
        'SELECT client_id FROM clients WHERE client_code = ?',
        [client_code]
      );

      if (existing.length > 0) {
        return res.status(409).json({ error: 'Client code already exists' });
      }

      const [result] = await con.promise().query(
        'INSERT INTO clients (client_name, client_code, description) VALUES (?, ?, ?)',
        [client_name, client_code, description || null]
      );

      res.status(201).json({
        message: 'Client created successfully',
        client_id: result.insertId
      });
    } catch (err) {
      console.error('Error creating client:', err);
      res.status(500).json({ error: 'Failed to create client' });
    }
  });

  // Delete a client
  app.delete('/v2/clients/:id', async (req, res) => {
    const clientId = req.params.id;

    try {
      // First, delete all assignments for this client
      await con.promise().query(
        'DELETE FROM client_assignments WHERE client_id = ?',
        [clientId]
      );

      // Then delete the client
      const [result] = await con.promise().query(
        'DELETE FROM clients WHERE client_id = ?',
        [clientId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Client not found' });
      }

      res.json({ message: 'Client deleted successfully' });
    } catch (err) {
      console.error('Error deleting client:', err);
      res.status(500).json({ error: 'Failed to delete client' });
    }
  });

  // Get all slots
  app.get('/v2/slots', async (req, res) => {
    try {
      const [slots] = await con.promise().query(
        'SELECT * FROM candidate_port_slots ORDER BY id'
      );
      res.json(slots);
    } catch (err) {
      console.error('Error fetching slots:', err);
      res.status(500).json({ error: 'Failed to fetch slots' });
    }
  });

  // Get all client assignments
  app.get('/v2/client-assignments', async (req, res) => {
    try {
      const [assignments] = await con.promise().query(
        `SELECT ca.*, c.client_name, cps.question_id, cps.docker_port, cps.frontend_port
         FROM client_assignments ca
         INNER JOIN clients c ON c.client_id = ca.client_id
         INNER JOIN candidate_port_slots cps ON cps.id = ca.slot_id
         WHERE ca.is_active = 1`
      );
      res.json(assignments);
    } catch (err) {
      console.error('Error fetching client assignments:', err);
      res.status(500).json({ error: 'Failed to fetch client assignments' });
    }
  });

  // Assign slots to a client
  app.post('/v2/client-assignments', async (req, res) => {
    const { client_id, slot_ids } = req.body;

    if (!client_id || !Array.isArray(slot_ids)) {
      return res.status(400).json({ error: 'client_id and slot_ids array are required' });
    }

    let connection;
    try {
      connection = await con.promise().getConnection();
      await connection.beginTransaction();

      // First, remove all existing assignments for this client
      await connection.query(
        'DELETE FROM client_assignments WHERE client_id = ?',
        [client_id]
      );

      // Then insert new assignments
      if (slot_ids.length > 0) {
        const values = slot_ids.map(slotId => [client_id, slotId]);
        await connection.query(
          'INSERT INTO client_assignments (client_id, slot_id) VALUES ?',
          [values]
        );
      }

      await connection.commit();
      res.json({ message: 'Slots assigned successfully', assigned_count: slot_ids.length });
    } catch (err) {
      if (connection) await connection.rollback();
      console.error('Error assigning slots:', err);
      res.status(500).json({ error: 'Failed to assign slots' });
    } finally {
      if (connection) connection.release();
    }
  });

   app.post('/v2/slots/reset', async (req, res) => {
    try {
      await con.promise().query(
        'UPDATE candidate_port_slots SET is_utilized = 0'
      );
      res.json({ message: 'All slot utilizations reset to 0' });
    } catch (err) {
      console.error('Error resetting slots:', err);
      res.status(500).json({ error: 'Failed to reset slots' });
    }
  });

  // Submit when candidate did NOT run the assessment (timer expired without dev server)
  app.post('/v2/submit-no-assessment', async (req, res) => {
    const { aonId, message } = req.body;

    if (!aonId) {
      return res.status(400).json({ error: 'Missing required field: aonId' });
    }

    try {
      // Check if already submitted
      const [latestTokenRows] = await con.promise().query(
        "SELECT submitted FROM launch_tokens WHERE aon_id = ? ORDER BY id DESC LIMIT 1",
        [aonId]
      );

      if (latestTokenRows.length > 0 && Number(latestTokenRows[0].submitted) === 1) {
        return res.json({ success: true, message: 'Assessment already submitted' });
      }

      // Mark as submitted
      await con.promise().query(
        "UPDATE launch_tokens SET submitted = 1, log_status = 0, closing_time_ms = 0 WHERE aon_id = ?",
        [aonId]
      );

      // Release port_slot when test is submitted
      try {
        const [tokenSlot] = await con.promise().query(
          "SELECT port_slot_id FROM launch_tokens WHERE aon_id = ? ORDER BY id DESC LIMIT 1",
          [aonId]
        );
        if (tokenSlot.length && tokenSlot[0].port_slot_id) {
          await con.promise().query(
            "UPDATE port_slots SET is_utilized = 0 WHERE id = ?",
            [tokenSlot[0].port_slot_id]
          );
          console.log(`✅ Port slot ${tokenSlot[0].port_slot_id} released (no-assessment) for ${aonId}`);
        }
      } catch (e) {
        console.error("Failed to release port_slot for aonId", aonId, e.message);
      }

      // Get redirect URL
      let redirectUrl = null;
      try {
        const [redirectRows] = await con.promise().query(
          "SELECT redirect_url FROM external_requests WHERE aon_id = ? AND redirect_url IS NOT NULL ORDER BY id DESC LIMIT 1",
          [aonId]
        );
        if (redirectRows.length && redirectRows[0].redirect_url) {
          redirectUrl = redirectRows[0].redirect_url;
        }
      } catch (e) {
        console.error("Failed to fetch redirect_url for aonId", aonId, e.message);
      }

      // Send webhook with message only (no results)
      const webhookPayload = {
        userId: aonId,
        result_data: null,
        overall_result: null,
        message: message || "The timer has run out also candidate do not attempted the test by following the guidelines",
        timestamp: new Date().toISOString(),
      };

      try {
        const [rows] = await con.promise().query(
          "SELECT results_webhook FROM external_requests WHERE aon_id = ? AND results_webhook IS NOT NULL ORDER BY id DESC LIMIT 1",
          [aonId]
        );

        if (rows.length && rows[0].results_webhook) {
          axios.post(
            rows[0].results_webhook,
            webhookPayload,
            {
              headers: {
                "Content-Type": "application/json",
                Authorization: "Basic " + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASS}`).toString("base64"),
              },
              timeout: 5000,
            }
          )
          .then(() => console.log("✅ No-assessment webhook delivered for", aonId))
          .catch(err => console.error("❌ No-assessment webhook failed:", err.message));
        }
      } catch (e) {
        console.error("Failed to send no-assessment webhook for aonId", aonId, e.message);
      }

      return res.json({
        success: true,
        message: 'Submitted without assessment',
        redirect_url: redirectUrl,
      });

    } catch (error) {
      console.error('Submit-no-assessment error:', error);
      return res.status(500).json({ error: 'Failed to submit', details: error.message });
    }
  });

  // ---------- CRON JOB: Clean up stale sessions every 30 minutes ----------
  const cron = require('node-cron');

  async function sendWebhookForUser(aonId, payload) {
    try {
      const [rows] = await con.promise().query(
        "SELECT results_webhook FROM external_requests WHERE aon_id = ? AND results_webhook IS NOT NULL ORDER BY id DESC LIMIT 1",
        [aonId]
      );
      if (rows.length && rows[0].results_webhook) {
        await axios.post(
          rows[0].results_webhook,
          payload,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: "Basic " + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASS}`).toString("base64"),
            },
            timeout: 10000,
          }
        );
        console.log(`✅ Cron webhook delivered for ${aonId}`);
      }
    } catch (e) {
      console.error(`❌ Cron webhook failed for ${aonId}:`, e.message);
    }
  }

  async function getRedirectUrl(aonId) {
    try {
      const [redirectRows] = await con.promise().query(
        "SELECT redirect_url FROM external_requests WHERE aon_id = ? AND redirect_url IS NOT NULL ORDER BY id DESC LIMIT 1",
        [aonId]
      );
      if (redirectRows.length && redirectRows[0].redirect_url) {
        return redirectRows[0].redirect_url;
      }
    } catch (e) {
      console.error("Failed to fetch redirect_url for aonId", aonId, e.message);
    }
    return null;
  }

  // cron.schedule('*/30 * * * *', async () => {
  //   console.log('🔄 [CRON] Running stale session cleanup...');

  //   try {
  //     // Find all launch_tokens where:
  //     // - submitted = 0 (not yet submitted)
  //     // - assessment_started = 1 (user opened the workspace)
  //     // - closing_time_ms is a deadline that has passed (timer expired)
  //     // - OR expires_at has passed
  //     const [staleSessions] = await con.promise().query(
  //       `SELECT lt.id, lt.aon_id, lt.closing_time_ms, lt.framework, lt.workspace_url,
  //               cps.question_id, cps.docker_port, cps.frontend_port
  //        FROM launch_tokens lt
  //        INNER JOIN candidate_port_slots cps ON cps.id = lt.slot_id
  //        WHERE lt.submitted = 0
  //          AND lt.log_status != 0
  //          AND (
  //            (lt.closing_time_ms IS NOT NULL AND lt.closing_time_ms > 1000000000000 AND lt.closing_time_ms < ?)
  //            OR lt.expires_at < NOW()
  //          )`,
  //       [Date.now()]
  //     );

  //     if (staleSessions.length === 0) {
  //       console.log('🧹 [CRON] No stale sessions found.');
  //       return;
  //     }

  //     console.log(`🧹 [CRON] Found ${staleSessions.length} stale session(s) to clean up.`);

  //     for (const session of staleSessions) {
  //       const { id, aon_id, framework, workspace_url, question_id, docker_port, frontend_port } = session;
  //       console.log(`🔧 [CRON] Processing stale session for ${aon_id} (token id: ${id})`);

  //       try {
  //         // Check if user ran the dev server by trying the assessment
  //         let results = null;
  //         let message = '';
  //         let assessmentRan = false;

  //         if (workspace_url && framework && question_id) {
  //           // User started the workspace - try to run assessment
  //           try {
  //             if (question_id === 'a1l1q1') {
  //               results = await a1l1q1(aon_id, framework, frontend_port);
  //             } else if (question_id === 'a1l1q2') {
  //               results = await a1l1q2(aon_id, framework, frontend_port);
  //             } else if (question_id === 'a1l1q3') {
  //               results = await a1l1q3(aon_id, framework, frontend_port);
  //             }
  //             assessmentRan = true;
  //             message = "the user exceeded the time so submitted automatically";
  //           } catch (assessErr) {
  //             // Dev server not running - user didn't run the application
  //             console.log(`[CRON] Assessment failed for ${aon_id} (dev server likely not running): ${assessErr.message}`);
  //             message = "The timer has run out also candidate do not attempted the test by following the guidelines";
  //           }
  //         } else {
  //           // User didn't even start the workspace properly
  //           message = "The timer has run out also candidate do not attempted the test by following the guidelines";
  //         }

  //         // Save results if assessment ran
  //         if (assessmentRan && results) {
  //           const overallResult = calculateOverallScores(results);
  //           await con.promise().query(
  //             "INSERT INTO results (userid, result_data, overall_result) VALUES (?, ?, ?)",
  //             [aon_id, JSON.stringify(results), JSON.stringify(overallResult)]
  //           );
  //         }

  //         // Mark as submitted
  //         await con.promise().query(
  //           "UPDATE launch_tokens SET submitted = 1, log_status = 0, closing_time_ms = 0 WHERE id = ?",
  //           [id]
  //         );

  //         // Send webhook
  //         const webhookPayload = {
  //           userId: aon_id,
  //           result_data: results,
  //           overall_result: results ? calculateOverallScores(results) : null,
  //           message: message,
  //           timestamp: new Date().toISOString(),
  //         };
  //         await sendWebhookForUser(aon_id, webhookPayload);

  //         // Insert activity logs
  //         await insertUserLogSafe(aon_id, 4); // docker cleanup
  //         await insertUserLogSafe(aon_id, 5); // logout

  //         // Clean up Docker if we have the info
  //         if (question_id && framework) {
  //           try {
  //             await runDockerCleanupForUser({ userId: aon_id, question: question_id, framework });
  //             console.log(`✅ [CRON] Docker cleaned up for ${aon_id}`);
  //           } catch (dockerErr) {
  //             console.error(`❌ [CRON] Docker cleanup failed for ${aon_id}:`, dockerErr.message);
  //           }
  //         }

  //         // Release the slot
  //         try {
  //           const [slotRows] = await con.promise().query(
  //             "SELECT slot_id FROM launch_tokens WHERE id = ?",
  //             [id]
  //           );
  //           if (slotRows.length) {
  //             await con.promise().query(
  //               "UPDATE candidate_port_slots SET is_utilized = 0 WHERE id = ?",
  //               [slotRows[0].slot_id]
  //             );
  //             console.log(`✅ [CRON] Slot released for ${aon_id}`);
  //           }
  //         } catch (slotErr) {
  //           console.error(`❌ [CRON] Slot release failed for ${aon_id}:`, slotErr.message);
  //         }

  //         console.log(`✅ [CRON] Stale session cleaned up for ${aon_id}`);

  //       } catch (sessionErr) {
  //         console.error(`❌ [CRON] Failed to process session for ${aon_id}:`, sessionErr.message);
  //       }
  //     }

  //     console.log('🔄 [CRON] Stale session cleanup completed.');
  //   } catch (err) {
  //     console.error('❌ [CRON] Stale session cleanup failed:', err.message);
  //   }
  // });

// ========== SINGLE TAB ENFORCEMENT ==========
// A candidate's test link may only be active in one browser tab at a time.
// Tabs send a heartbeat every 10s; a tab is considered closed after 25s of silence.

const TAB_HEARTBEAT_TIMEOUT_MS = 60000; // 60 s — beacon releases instantly on real close

// Claim the active-tab slot for a launch token
app.post('/v2/aon/claim-tab', async (req, res) => {
  const { launchTokenId, tabId } = req.body;
  if (!launchTokenId || !tabId) {
    return res.status(400).json({ error: 'launchTokenId and tabId are required' });
  }
  try {
    const [rows] = await con.promise().query(
      `SELECT submitted, active_tab_id, tab_heartbeat_at FROM launch_tokens WHERE id = ? LIMIT 1`,
      [launchTokenId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Launch token not found' });
    }
    const row = rows[0];
    if (Number(row.submitted) === 1) {
      return res.json({ status: 'submitted' });
    }
    const lastBeat = row.tab_heartbeat_at ? Number(row.tab_heartbeat_at) : 0;
    const isStale = (Date.now() - lastBeat) > TAB_HEARTBEAT_TIMEOUT_MS;
    if (!row.active_tab_id || isStale || row.active_tab_id === tabId) {
      await con.promise().query(
        `UPDATE launch_tokens SET active_tab_id = ?, tab_heartbeat_at = ? WHERE id = ?`,
        [tabId, Date.now(), launchTokenId]
      );
      return res.json({ status: 'allowed' });
    }
    return res.json({ status: 'blocked' });
  } catch (err) {
    console.error('Claim tab error:', err);
    return res.status(500).json({ error: 'Failed to claim tab' });
  }
});

// Heartbeat — keeps the active-tab slot alive
app.post('/v2/aon/tab-heartbeat', async (req, res) => {
  const { launchTokenId, tabId } = req.body;
  if (!launchTokenId || !tabId) {
    return res.status(400).json({ error: 'launchTokenId and tabId are required' });
  }
  try {
    const [rows] = await con.promise().query(
      `SELECT active_tab_id FROM launch_tokens WHERE id = ? LIMIT 1`,
      [launchTokenId]
    );
    if (!rows.length) {
      return res.json({ status: 'not_found' });
    }
    if (rows[0].active_tab_id !== tabId) {
      return res.json({ status: 'evicted' });
    }
    await con.promise().query(
      `UPDATE launch_tokens SET tab_heartbeat_at = ? WHERE id = ? AND active_tab_id = ?`,
      [Date.now(), launchTokenId, tabId]
    );
    return res.json({ status: 'ok' });
  } catch (err) {
    console.error('Tab heartbeat error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Release the active-tab slot (called via sendBeacon on tab close)
app.post('/v2/aon/release-tab', async (req, res) => {
  const { launchTokenId, tabId } = req.body;
  if (!launchTokenId || !tabId) {
    return res.status(400).json({ error: 'launchTokenId and tabId are required' });
  }
  try {
    await con.promise().query(
      `UPDATE launch_tokens SET active_tab_id = NULL, tab_heartbeat_at = NULL
       WHERE id = ? AND active_tab_id = ?`,
      [launchTokenId, tabId]
    );
    return res.json({ status: 'released' });
  } catch (err) {
    console.error('Release tab error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});


// New Home Page
app.post("/v2/generate-test-link", async (req, res) => {
  const { name, rollNumber } = req.body;

  if (!name || !rollNumber) {
    return res.status(400).json({ message: "Missing fields" });
  }

  const aon_id = `AON-${rollNumber}`;

  try {
    const response = await axios.post(
      "https://aws-test.starsquare.in/api/v2/external/assign",
      {
        session_id: "AON-SESSION-LOADTEST",
        aon_id,
        client_id: "LOAD_TEST",
        redirect_url: "https://cocubes.com/logout&link=0&rand=1#completed",
        results_webhook: "https://pulpitless-seclusively-ilona.ngrok-free.dev/webhook",
      },
      {
        auth: {
          username: process.env.BASIC_AUTH_USER,
          password: process.env.BASIC_AUTH_PASS,
        },
      }
    );

    const payload = response.data || {};
    const test_link =
      payload.test_url ||
      payload.test_link ||
      payload.url ||
      payload.data?.test_url ||
      payload.data?.test_link ||
      payload.data?.url ||
      null;

    if (!test_link) {
      console.warn("External API returned no test link:", payload);
    }

    con.query(
      "INSERT INTO students (name, roll_number, aon_id, test_link) VALUES (?, ?, ?, ?)",
      [name, rollNumber, aon_id, test_link],
      (err) => {
        if (err) {
          console.error("DB insert error:", err);
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
              message: "Roll number already exists",
            });
          }
          return res.status(500).json({
            message: "Database error",
            details: err.message,
          });
        }

        res.json({ aon_id, test_link, api_response: payload });
      }
    );

  } catch (error) {
    const status = error.response?.status;
    const errData = error.response?.data || {};

    // If aon_id already has a link, fetch and return it instead of erroring
    if (status === 409) {
      const existingLink = errData.existing_link || null;
      if (existingLink) {
        console.log(`[${aon_id}] ℹ️  Returning existing test link`);
        return res.json({ aon_id, test_link: existingLink, already_existed: true });
      }
      // Fallback: look up from students table
      try {
        const [rows] = await con.promise().query(
          `SELECT test_link FROM students WHERE aon_id = ? LIMIT 1`,
          [aon_id]
        );
        if (rows.length && rows[0].test_link) {
          console.log(`[${aon_id}] ℹ️  Returning existing test link from DB`);
          return res.json({ aon_id, test_link: rows[0].test_link, already_existed: true });
        }
      } catch (dbErr) {
        console.error(`[${aon_id}] DB lookup failed:`, dbErr.message);
      }
      return res.status(409).json({
        message: errData.message || "A test link already exists for this roll number.",
      });
    }

    console.error(`Generate test link failed [${status || 'no-response'}]:`, errData || error.message);
    res.status(500).json({
      message: "Failed to generate test link. Please try again.",
      details: errData.message || error.message || "Unknown error",
    });
  }
});

// Admin API
app.get("/v2/admin/students", (req, res) => {
  con.query("SELECT * FROM students ORDER BY created_at DESC", (err, data) => {
    res.json(data);
  });
});

// ========== BUSINESS MANAGEMENT (SuperAdmin) ==========

// Get all businesses
app.get('/v2/businesses', async (req, res) => {
  try {
    const [businesses] = await con.promise().query(
      `SELECT b.*, 
        (SELECT COUNT(*) FROM clients c WHERE c.business_id = b.business_id) AS client_count
       FROM businesses b ORDER BY b.business_name`
    );
    res.json(businesses);
  } catch (err) {
    console.error('Error fetching businesses:', err);
    res.status(500).json({ error: 'Failed to fetch businesses' });
  }
});

// Get single business with clients
app.get('/v2/businesses/:id', async (req, res) => {
  try {
    const [businesses] = await con.promise().query(
      `SELECT * FROM businesses WHERE business_id = ?`,
      [req.params.id]
    );
    if (!businesses.length) return res.status(404).json({ error: 'Business not found' });

    const [clients] = await con.promise().query(
      `SELECT c.*, 
        (SELECT COUNT(*) FROM client_questions cq WHERE cq.client_id = c.client_id AND cq.is_active = 1) AS question_count
       FROM clients c WHERE c.business_id = ? ORDER BY c.client_name`,
      [req.params.id]
    );

    res.json({ ...businesses[0], clients });
  } catch (err) {
    console.error('Error fetching business:', err);
    res.status(500).json({ error: 'Failed to fetch business' });
  }
});

// Create business
app.post('/v2/businesses', async (req, res) => {
  const { business_name, business_code, description, subscription_limit } = req.body;
  if (!business_name || !business_code) {
    return res.status(400).json({ error: 'business_name and business_code are required' });
  }
  try {
    const [existing] = await con.promise().query(
      'SELECT business_id FROM businesses WHERE business_code = ?',
      [business_code]
    );
    if (existing.length) return res.status(409).json({ error: 'Business code already exists' });

    const [result] = await con.promise().query(
      'INSERT INTO businesses (business_name, business_code, description, subscription_limit) VALUES (?, ?, ?, ?)',
      [business_name, business_code, description || null, subscription_limit || 0]
    );
    res.status(201).json({ message: 'Business created', business_id: result.insertId });
  } catch (err) {
    console.error('Error creating business:', err);
    res.status(500).json({ error: 'Failed to create business' });
  }
});

// Update business
app.put('/v2/businesses/:id', async (req, res) => {
  const { business_name, description, subscription_limit } = req.body;
  try {
    const [result] = await con.promise().query(
      'UPDATE businesses SET business_name = COALESCE(?, business_name), description = COALESCE(?, description), subscription_limit = COALESCE(?, subscription_limit) WHERE business_id = ?',
      [business_name || null, description || null, subscription_limit != null ? subscription_limit : null, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Business not found' });
    res.json({ message: 'Business updated' });
  } catch (err) {
    console.error('Error updating business:', err);
    res.status(500).json({ error: 'Failed to update business' });
  }
});

// Delete business
app.delete('/v2/businesses/:id', async (req, res) => {
  try {
    // Unlink clients first
    await con.promise().query('UPDATE clients SET business_id = NULL WHERE business_id = ?', [req.params.id]);
    const [result] = await con.promise().query('DELETE FROM businesses WHERE business_id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Business not found' });
    res.json({ message: 'Business deleted' });
  } catch (err) {
    console.error('Error deleting business:', err);
    res.status(500).json({ error: 'Failed to delete business' });
  }
});

// ========== CLIENT QUESTIONS MANAGEMENT ==========

// Get questions assigned to a client
app.get('/v2/client-questions/:clientId', async (req, res) => {
  try {
    const [questions] = await con.promise().query(
      `SELECT cq.*, aq.question_name, aq.description AS question_description
       FROM client_questions cq
       INNER JOIN assessment_questions aq ON aq.question_id = cq.question_id
       WHERE cq.client_id = ? AND cq.is_active = 1`,
      [req.params.clientId]
    );
    res.json(questions);
  } catch (err) {
    console.error('Error fetching client questions:', err);
    res.status(500).json({ error: 'Failed to fetch client questions' });
  }
});

// Assign questions to a client (replaces existing assignments)
app.post('/v2/client-questions', async (req, res) => {
  const { client_id, question_ids } = req.body;
  if (!client_id || !Array.isArray(question_ids)) {
    return res.status(400).json({ error: 'client_id and question_ids array are required' });
  }
  let connection;
  try {
    connection = await con.promise().getConnection();
    await connection.beginTransaction();
    await connection.query('DELETE FROM client_questions WHERE client_id = ?', [client_id]);
    if (question_ids.length > 0) {
      const values = question_ids.map(qid => [client_id, qid]);
      await connection.query('INSERT INTO client_questions (client_id, question_id) VALUES ?', [values]);
    }
    await connection.commit();
    res.json({ message: 'Questions assigned', assigned_count: question_ids.length });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error assigning questions:', err);
    res.status(500).json({ error: 'Failed to assign questions' });
  } finally {
    if (connection) connection.release();
  }
});

// Get all assessment questions
app.get('/v2/assessment-questions', async (req, res) => {
  try {
    const [questions] = await con.promise().query(
      'SELECT * FROM assessment_questions WHERE is_active = 1 ORDER BY question_id'
    );
    res.json(questions);
  } catch (err) {
    console.error('Error fetching assessment questions:', err);
    res.status(500).json({ error: 'Failed to fetch assessment questions' });
  }
});

// ========== UPDATED CLIENTS (with business_id) ==========

// Create client with business_id
app.post('/v2/clients-v2', async (req, res) => {
  const { client_name, client_code, description, business_id } = req.body;
  if (!client_name || !client_code) {
    return res.status(400).json({ error: 'client_name and client_code are required' });
  }
  try {
    const [existing] = await con.promise().query('SELECT client_id FROM clients WHERE client_code = ?', [client_code]);
    if (existing.length) return res.status(409).json({ error: 'Client code already exists' });
    const [result] = await con.promise().query(
      'INSERT INTO clients (client_name, client_code, description, business_id) VALUES (?, ?, ?, ?)',
      [client_name, client_code, description || null, business_id || null]
    );
    res.status(201).json({ message: 'Client created', client_id: result.insertId });
  } catch (err) {
    console.error('Error creating client:', err);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// Update client business assignment
app.put('/v2/clients/:id', async (req, res) => {
  const { client_name, description, business_id } = req.body;
  try {
    await con.promise().query(
      'UPDATE clients SET client_name = COALESCE(?, client_name), description = COALESCE(?, description), business_id = ? WHERE client_id = ?',
      [client_name || null, description || null, business_id != null ? business_id : null, req.params.id]
    );
    res.json({ message: 'Client updated' });
  } catch (err) {
    console.error('Error updating client:', err);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// ========== SUPERADMIN DASHBOARD ==========

app.get('/v2/superadmin/dashboard', async (req, res) => {
  let businesses = [];
  let portSlotStats = { total_slots: 0, utilized_slots: 0, free_slots: 0 };
  let questionStats = [];
  let recentAssignments = [];

  try {
    const [rows] = await con.promise().query(
      `SELECT b.*, 
        (SELECT COUNT(*) FROM clients c WHERE c.business_id = b.business_id) AS client_count
       FROM businesses b ORDER BY b.business_name`
    );
    businesses = rows;
  } catch (e) {
    console.warn('businesses table not available:', e.message);
  }

  try {
    const [rows] = await con.promise().query(
      `SELECT 
        COUNT(*) AS total_slots,
        SUM(is_utilized = 1) AS utilized_slots,
        SUM(is_utilized = 0) AS free_slots
       FROM port_slots`
    );
    portSlotStats = rows[0] || portSlotStats;
  } catch (e) {
    // Fallback to candidate_port_slots if port_slots table doesn't exist
    try {
      const [rows] = await con.promise().query(
        `SELECT 
          COUNT(*) AS total_slots,
          SUM(is_utilized = 1) AS utilized_slots,
          SUM(is_utilized = 0) AS free_slots
         FROM candidate_port_slots`
      );
      portSlotStats = rows[0] || portSlotStats;
    } catch (e2) {
      console.warn('Port slots tables not available:', e2.message);
    }
  }

  try {
    const [rows] = await con.promise().query(
      `SELECT question_id, question_name FROM assessment_questions WHERE is_active = 1`
    );
    questionStats = rows;
  } catch (e) {
    console.warn('assessment_questions table not available:', e.message);
  }

  try {
    const [rows] = await con.promise().query(
      `SELECT tau.*, c.client_name 
       FROM test_assignment_users tau
       LEFT JOIN clients c ON c.client_code = tau.client_id OR c.client_id = tau.client_id
       ORDER BY tau.id DESC LIMIT 20`
    );
    recentAssignments = rows;
  } catch (e) {
    console.warn('test_assignment_users table not available:', e.message);
  }

  res.json({
    businesses,
    port_slots: portSlotStats,
    questions: questionStats,
    recent_assignments: recentAssignments
  });
});

// Port slots overview for SuperAdmin
app.get('/v2/port-slots/stats', async (req, res) => {
  try {
    const [stats] = await con.promise().query(
      `SELECT 
        COUNT(*) AS total,
        SUM(is_utilized = 1) AS utilized,
        SUM(is_utilized = 0) AS free
       FROM port_slots`
    );
    res.json(stats[0]);
  } catch (err) {
    console.error('Error fetching port slot stats:', err);
    res.status(500).json({ error: 'Failed to fetch port slot stats' });
  }
});

// Reset port slots
app.post('/v2/port-slots/reset', async (req, res) => {
  try {
    await con.promise().query('UPDATE port_slots SET is_utilized = 0');
    res.json({ message: 'All port slot utilizations reset' });
  } catch (err) {
    console.error('Error resetting port slots:', err);
    res.status(500).json({ error: 'Failed to reset port slots' });
  }
});

// ========== ASSESSMENT BATCH MANAGEMENT (SuperAdmin) ==========

// Get all assessment batches
app.get('/v2/assessment-batches', async (req, res) => {
  try {
    const [batches] = await con.promise().query(
      `SELECT ab.*,
        c.client_name, c.client_code,
        b.business_name,
        COUNT(pac.id) AS total_containers,
        SUM(pac.is_assigned = 0 AND pac.is_deprovisioned = 0) AS available_containers,
        SUM(pac.is_assigned = 1) AS assigned_containers,
        SUM(pac.is_deprovisioned = 1) AS deprovisioned_containers
       FROM assessment_batches ab
       LEFT JOIN clients c ON c.client_id = ab.client_id
       LEFT JOIN businesses b ON b.business_id = ab.business_id
       LEFT JOIN pre_allocated_containers pac ON pac.batch_id = ab.id
       GROUP BY ab.id
       ORDER BY ab.created_at DESC`
    );
    res.json(batches);
  } catch (err) {
    console.error('Error fetching assessment batches:', err);
    res.status(500).json({ error: 'Failed to fetch assessment batches' });
  }
});

// Get single assessment batch with its containers
app.get('/v2/assessment-batches/:id', async (req, res) => {
  try {
    const [batches] = await con.promise().query(
      `SELECT ab.*, c.client_name, c.client_code, b.business_name
       FROM assessment_batches ab
       LEFT JOIN clients c ON c.client_id = ab.client_id
       LEFT JOIN businesses b ON b.business_id = ab.business_id
       WHERE ab.id = ?`,
      [req.params.id]
    );
    if (!batches.length) return res.status(404).json({ error: 'Batch not found' });

    const [containers] = await con.promise().query(
      `SELECT pac.*, ps.docker_port, ps.output_port
       FROM pre_allocated_containers pac
       LEFT JOIN port_slots ps ON ps.id = pac.port_slot_id
       WHERE pac.batch_id = ?
       ORDER BY pac.id ASC`,
      [req.params.id]
    );

    res.json({
      ...batches[0],
      containers: containers.map((container, index) => ({
        ...container,
        ...buildContainerAccess({
          dockerPort: container.docker_port,
          outputPort: container.output_port,
          serverNumber: container.container_server_number || getContainerServerNumber(index + 1)
        })
      }))
    });
  } catch (err) {
    console.error('Error fetching batch:', err);
    res.status(500).json({ error: 'Failed to fetch batch' });
  }
});

// Create assessment batch
app.post('/v2/assessment-batches', async (req, res) => {
  const { batch_name, client_id, estimated_users } = req.body;
  if (!batch_name || !client_id || !estimated_users) {
    return res.status(400).json({ error: 'batch_name, client_id, and estimated_users are required' });
  }
  try {
    const [clients] = await con.promise().query(
      'SELECT client_id, business_id FROM clients WHERE client_id = ?',
      [client_id]
    );
    if (!clients.length) return res.status(404).json({ error: 'Client not found' });

    const [result] = await con.promise().query(
      'INSERT INTO assessment_batches (batch_name, client_id, business_id, estimated_users, status) VALUES (?, ?, ?, ?, ?)',
      [batch_name, client_id, clients[0].business_id || null, Number(estimated_users), 'draft']
    );
    res.status(201).json({ message: 'Assessment batch created', batch_id: result.insertId });
  } catch (err) {
    console.error('Error creating batch:', err);
    res.status(500).json({ error: 'Failed to create batch' });
  }
});

// Update assessment batch status
app.put('/v2/assessment-batches/:id', async (req, res) => {
  const { status, batch_name, estimated_users } = req.body;
  try {
    const [result] = await con.promise().query(
      `UPDATE assessment_batches
       SET batch_name = COALESCE(?, batch_name),
           estimated_users = COALESCE(?, estimated_users),
           status = COALESCE(?, status)
       WHERE id = ?`,
      [batch_name || null, estimated_users != null ? Number(estimated_users) : null, status || null, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Batch not found' });
    res.json({ message: 'Batch updated' });
  } catch (err) {
    console.error('Error updating batch:', err);
    res.status(500).json({ error: 'Failed to update batch' });
  }
});

// Provision containers for an assessment batch
// Picks port_slots in order (lowest id first) and distributes questions round-robin
app.post('/v2/assessment-batches/:id/provision', async (req, res) => {
  const batchId = req.params.id;

  let connection;
  try {
    if (isProductionContainerRouting() && !process.env.CONTAINER_SERVER_PROVISION_URL_TEMPLATE) {
      return res.status(500).json({
        error: 'Missing production container routing configuration',
        message: 'Set CONTAINER_SERVER_PROVISION_URL_TEMPLATE before provisioning in production mode.'
      });
    }

    const [batches] = await con.promise().query(
      'SELECT * FROM assessment_batches WHERE id = ?',
      [batchId]
    );
    if (!batches.length) return res.status(404).json({ error: 'Batch not found' });

    const batch = batches[0];

    // Check if already provisioned (exclude deprovisioned containers)
    const [existingContainers] = await con.promise().query(
      'SELECT COUNT(*) AS cnt FROM pre_allocated_containers WHERE batch_id = ? AND is_deprovisioned = 0',
      [batchId]
    );
    if (existingContainers[0].cnt > 0) {
      return res.status(409).json({
        error: 'Batch already provisioned',
        message: `This batch already has ${existingContainers[0].cnt} active containers. Deprovision them before re-provisioning.`
      });
    }

    // Get questions assigned to this client (ordered)
    const [questions] = await con.promise().query(
      `SELECT cq.question_id, aq.question_name
       FROM client_questions cq
       JOIN assessment_questions aq ON aq.question_id = cq.question_id
       WHERE cq.client_id = ? AND cq.is_active = 1
       ORDER BY cq.question_id ASC`,
      [batch.client_id]
    );
    if (!questions.length) {
      return res.status(400).json({ error: 'No active questions assigned to this client' });
    }

    // Get the latest active test
    const [tests] = await con.promise().query(
      `SELECT id, test_name FROM tests WHERE status = 'Active' ORDER BY id DESC LIMIT 1`
    );
    if (!tests.length) {
      return res.status(400).json({ error: 'No active test found' });
    }
    const selectedTest = tests[0];

    const n = batch.estimated_users;

    connection = await con.promise().getConnection();
    await connection.beginTransaction();

    // Pick n consecutive free port_slots ordered by id ASC (with lock)
    const [freeSlots] = await connection.query(
      `SELECT id, docker_port, output_port FROM port_slots
       WHERE is_utilized = 0
       ORDER BY id ASC
       LIMIT ? FOR UPDATE`,
      [n]
    );
    if (freeSlots.length < n) {
      await connection.rollback();
      return res.status(400).json({
        error: 'Not enough free port slots',
        message: `Requested ${n} containers but only ${freeSlots.length} free slots available`
      });
    }

    // Mark selected slots as utilized
    const slotIds = freeSlots.map(s => s.id);
    await connection.query(
      `UPDATE port_slots SET is_utilized = 1 WHERE id IN (?)`,
      [slotIds]
    );

    // Build container rows — round-robin question assignment
    const containerRows = freeSlots.map((slot, idx) => {
      const q = questions[idx % questions.length];
      
      const containerServerNumber = getContainerServerNumber(idx + 1);
      return [
        batchId,
        selectedTest.id,
        q.question_id,
        slot.id,
        slot.docker_port,
        slot.output_port,
        containerServerNumber
      ];
    });

    await connection.query(
      `INSERT INTO pre_allocated_containers
       (batch_id, test_id, question_id, port_slot_id, docker_port, output_port, container_server_number)
       VALUES ?`,
      [containerRows]
    );

    // Set batch to active
    await connection.query(
      `UPDATE assessment_batches SET status = 'active' WHERE id = ?`,
      [batchId]
    );

    await connection.commit();

    // Set container_identifier = CONCAT('pac', id) for all containers just inserted
    await con.promise().query(
      `UPDATE pre_allocated_containers SET container_identifier = CONCAT('pac', id) WHERE batch_id = ? AND container_identifier IS NULL`,
      [batchId]
    );

    // Fetch inserted containers and fire Docker creation scripts (async, non-blocking)
    const [provisionedContainers] = await con.promise().query(
      `SELECT id, question_id, docker_port, output_port, container_server_number
       FROM pre_allocated_containers
       WHERE batch_id = ? AND is_deprovisioned = 0
       ORDER BY id ASC`,
      [batchId]
    );

    for (const c of provisionedContainers) {
      dispatchProvisionedContainer(batchId, c);
    }

    console.log(`[Batch:${batchId}] ✅ Provisioned ${n} containers for test "${selectedTest.test_name}"`);
    res.json({
      message: 'Containers provisioned successfully',
      batch_id: Number(batchId),
      test_id: selectedTest.id,
      test_name: selectedTest.test_name,
      containers_created: n,
      routing_mode: isProductionContainerRouting() ? 'production' : 'development',
      containers_per_server: getContainersPerServer(),
      server_distribution: provisionedContainers.reduce((acc, container) => {
        const key = String(container.container_server_number || 1);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      questions_used: questions.map(q => q.question_id)
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error(`Error provisioning batch ${batchId}:`, err);
    res.status(500).json({ error: 'Failed to provision containers', details: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// Deprovision containers for a batch — marks ALL containers as deprovisioned, releases port slots, stops Docker containers
// Data is kept in DB (soft delete) and visible in the UI as "deprovisioned". Marks batch as completed.
app.delete('/v2/assessment-batches/:id/containers', async (req, res) => {
  const batchId = req.params.id;
  let connection;
  try {
    connection = await con.promise().getConnection();
    await connection.beginTransaction();

    // Get ALL non-deprovisioned containers for this batch (including assigned ones)
    const [containers] = await connection.query(
      `SELECT id, port_slot_id, container_identifier, question_id
       FROM pre_allocated_containers
       WHERE batch_id = ? AND is_deprovisioned = 0`,
      [batchId]
    );

    if (containers.length) {
      const ids = containers.map(c => c.id);
      const slotIds = containers.map(c => c.port_slot_id);

      // Release ALL port slots back to the pool
      await connection.query(
        'UPDATE port_slots SET is_utilized = 0 WHERE id IN (?)',
        [slotIds]
      );

      // Mark ALL containers as deprovisioned (soft delete — data stays visible)
      await connection.query(
        'UPDATE pre_allocated_containers SET is_deprovisioned = 1 WHERE id IN (?)',
        [ids]
      );
    }

    // Mark batch as completed (full deprovision = batch lifecycle done)
    await connection.query(
      `UPDATE assessment_batches SET status = 'completed' WHERE id = ?`,
      [batchId]
    );

    await connection.commit();

    // Fire Docker cleanup for every container (async, non-blocking)
    const framework = 'react';
    for (const c of containers) {
      if (c.container_identifier) {
        runDockerCleanupForUser({
          userId: c.container_identifier,
          question: c.question_id,
          framework
        }).catch(err => {
          console.error(`[Batch:${batchId}] ❌ Docker cleanup failed for ${c.container_identifier}: ${err.message}`);
        });
      }
    }

    res.json({
      message: 'All containers deprovisioned - port slots released and Docker containers stopping',
      deprovisioned_count: containers.length
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error(`Error deprovisioning batch ${batchId}:`, err);
    res.status(500).json({ error: 'Failed to deprovision containers' });
  } finally {
    if (connection) connection.release();
  }
});

app.listen(process.env.PORT || 5000, () => { 
    console.log(`the port is running in ${process.env.PORT || 5000}`)
})
