#!/usr/bin/env node

// scripts/intercept-plan.ts
import http from "http";
import net from "net";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var SERVER_HOST = "localhost";
var SERVER_PORT = 3030;
var POLL_INTERVAL = 2e3;
var MAX_WAIT_TIME = 57e4;
var SERVER_STARTUP_TIMEOUT = 1e4;
var DEBUG = process.env.CC_PLAN_REVIEW_DEBUG === "1" || process.env.DEBUG === "1";
function isServerRunning() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1e3);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(SERVER_PORT, SERVER_HOST);
  });
}
async function startHttpServer() {
  debug("Starting HTTP server...");
  const httpOnlyPath = path.join(__dirname, "..", "http-only.js");
  debug("HTTP server path", { httpOnlyPath });
  return new Promise((resolve) => {
    const child = spawn("node", [httpOnlyPath], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, CC_PLAN_REVIEW_DEBUG: DEBUG ? "1" : "0" }
    });
    let output = "";
    const timeoutId = setTimeout(() => {
      debug("Server startup timeout");
      child.stdout?.removeAllListeners();
      resolve(false);
    }, SERVER_STARTUP_TIMEOUT);
    child.stdout?.on("data", (data) => {
      output += data.toString();
      try {
        const result = JSON.parse(output.trim());
        clearTimeout(timeoutId);
        if (result.status === "ready") {
          debug("HTTP server started successfully", { port: result.port });
          child.unref();
          resolve(true);
        } else {
          debug("HTTP server failed to start", { result });
          resolve(false);
        }
      } catch {
      }
    });
    child.on("error", (err) => {
      clearTimeout(timeoutId);
      debug("Failed to spawn HTTP server", { error: err.message });
      resolve(false);
    });
  });
}
async function ensureServerRunning() {
  if (await isServerRunning()) {
    debug("HTTP server already running");
    return true;
  }
  debug("HTTP server not running, attempting to start...");
  const started = await startHttpServer();
  if (started) {
    await new Promise((r) => setTimeout(r, 500));
    return await isServerRunning();
  }
  return false;
}
function debug(message, data) {
  if (!DEBUG) return;
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const logMessage = data !== void 0 ? `[DEBUG ${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}` : `[DEBUG ${timestamp}] ${message}`;
  console.error(logMessage);
}
function extractReviewId(planContent) {
  const match = planContent.match(/<!--\s*REVIEW_ID:\s*([a-f0-9-]+)\s*-->/i);
  return match ? match[1] : null;
}
function removeReviewIdMarker(planContent) {
  return planContent.replace(/<!--\s*REVIEW_ID:\s*[a-f0-9-]+\s*-->\n?/gi, "");
}
function httpRequest(options, postData) {
  debug("httpRequest", { method: options.method, path: options.path, postDataLength: postData?.length });
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const result = { statusCode: res.statusCode, data: JSON.parse(data) };
          debug("httpRequest response", { statusCode: res.statusCode, dataKeys: Object.keys(result.data || {}) });
          resolve(result);
        } catch {
          debug("httpRequest response (non-JSON)", { statusCode: res.statusCode });
          resolve({ statusCode: res.statusCode, data: null });
        }
      });
    });
    req.on("error", (err) => {
      debug("httpRequest error", { error: err.message });
      reject(err);
    });
    req.setTimeout(5e3, () => {
      debug("httpRequest timeout");
      req.destroy();
      reject(new Error("Request timeout"));
    });
    if (postData) req.write(postData);
    req.end();
  });
}
async function createReview(plan, projectPath) {
  debug("createReview", { planLength: plan.length, projectPath });
  const postData = JSON.stringify({ plan, projectPath });
  const result = await httpRequest({
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    path: "/api/reviews",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData)
    }
  }, postData);
  if (result.statusCode !== 200 || !result.data) {
    throw new Error("Failed to create review session");
  }
  return result.data;
}
async function updateReviewPlan(reviewId, plan) {
  debug("updateReviewPlan", { reviewId, planLength: plan.length });
  const postData = JSON.stringify({
    content: plan,
    author: "agent",
    changeDescription: "\u6839\u636E\u5BA1\u6838\u53CD\u9988\u4FEE\u8BA2"
  });
  const result = await httpRequest({
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    path: `/api/reviews/${reviewId}/plan`,
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData)
    }
  }, postData);
  if (result.statusCode !== 200 || !result.data) {
    throw new Error(`Failed to update review: ${result.data?.error || "Unknown error"}`);
  }
  return result.data;
}
async function getReview(reviewId) {
  try {
    const result = await httpRequest({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: `/api/reviews/${reviewId}`,
      method: "GET"
    });
    return result.statusCode === 200 ? result.data : null;
  } catch {
    return null;
  }
}
function waitForReviewWithSSE(reviewId, timeout) {
  debug("waitForReviewWithSSE", { reviewId, timeout });
  return new Promise((resolve) => {
    const startTime = Date.now();
    let resolved = false;
    debug("SSE connecting", { path: `/api/reviews/${reviewId}/events` });
    const req = http.get({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: `/api/reviews/${reviewId}/events`,
      headers: { "Accept": "text/event-stream" }
    }, (res) => {
      debug("SSE connected", { statusCode: res.statusCode });
      let currentEventType = "";
      res.on("data", (chunk) => {
        if (resolved) return;
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              debug("SSE event received", { type: currentEventType, data });
              if (currentEventType === "status_changed" && (data.status === "approved" || data.status === "changes_requested")) {
                debug(`Review status changed to ${data.status} via SSE`);
                resolved = true;
                req.destroy();
                getReview(reviewId).then((review) => {
                  resolve(review || "timeout");
                });
                return;
              }
            } catch {
            }
          }
        }
      });
    });
    req.on("error", (err) => {
      debug("SSE error, falling back to polling", { error: err.message });
      if (!resolved) {
        resolved = true;
        pollForReview(reviewId, timeout - (Date.now() - startTime)).then(resolve);
      }
    });
    setTimeout(() => {
      if (!resolved) {
        debug("waitForReviewWithSSE timeout");
        resolved = true;
        req.destroy();
        resolve("timeout");
      }
    }, timeout);
  });
}
async function pollForReview(reviewId, timeout) {
  debug("pollForReview started", { reviewId, timeout });
  const startTime = Date.now();
  let pollCount = 0;
  while (Date.now() - startTime < timeout) {
    pollCount++;
    debug("pollForReview polling", { pollCount, elapsed: Date.now() - startTime });
    const review = await getReview(reviewId);
    if (review && (review.status === "approved" || review.status === "changes_requested")) {
      debug(`pollForReview: review status is ${review.status}`, { pollCount });
      return review;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  debug("pollForReview timeout", { pollCount });
  return "timeout";
}
function formatComments(comments) {
  const unresolvedComments = comments.filter((c) => !c.resolved);
  if (unresolvedComments.length === 0) return "";
  return unresolvedComments.map((item, index) => {
    return `${index + 1}. [\u5F15\u7528: "${item.quote}"] \u2192 \u8BC4\u8BBA: ${item.comment}`;
  }).join("\n");
}
async function main() {
  debug("Hook script started");
  let inputData = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }
  debug("Received stdin input", { length: inputData.length });
  try {
    const input = JSON.parse(inputData);
    debug("Parsed hook input", {
      tool_name: input.tool_name,
      hook_event_name: input.hook_event_name,
      cwd: input.cwd,
      session_id: input.session_id,
      tool_input_keys: Object.keys(input.tool_input || {})
    });
    if (input.tool_name !== "ExitPlanMode") {
      debug("Skipping non-ExitPlanMode tool");
      console.log(JSON.stringify({ decision: "approve" }));
      process.exit(0);
    }
    const rawPlanContent = input.tool_input?.plan || input.tool_input?.summary || "Plan review requested";
    debug("Raw plan content extracted", { planContentLength: rawPlanContent.length });
    const existingReviewId = extractReviewId(rawPlanContent);
    const planContent = existingReviewId ? removeReviewIdMarker(rawPlanContent) : rawPlanContent;
    debug("Review ID check", { existingReviewId, cleanPlanLength: planContent.length });
    let review;
    let isRevision = false;
    const serverRunning = await ensureServerRunning();
    if (!serverRunning) {
      debug("HTTP server not available, allowing through");
      console.error("HTTP server not available");
      console.log(JSON.stringify({ decision: "approve" }));
      process.exit(0);
    }
    if (existingReviewId) {
      debug("Revision detected, updating existing review", { reviewId: existingReviewId });
      try {
        const existingReview = await getReview(existingReviewId);
        if (!existingReview) {
          throw new Error(`Review ${existingReviewId} not found`);
        }
        review = await updateReviewPlan(existingReviewId, planContent);
        isRevision = true;
        debug("Review updated successfully", { reviewId: review.id, status: review.status });
      } catch (error) {
        debug("Failed to update review, creating new one", { error: String(error) });
        review = await createReview(planContent, input.cwd);
        debug("New review created as fallback", { reviewId: review.id });
      }
    } else {
      try {
        review = await createReview(planContent, input.cwd);
        debug("New review session created", { reviewId: review.id, status: review.status });
      } catch (error) {
        debug("Failed to create review, allowing through", { error: String(error) });
        console.error(`Failed to create review: ${error}`);
        console.log(JSON.stringify({ decision: "approve" }));
        process.exit(0);
      }
    }
    debug("Waiting for review completion");
    const result = await waitForReviewWithSSE(review.id, MAX_WAIT_TIME);
    debug("Review wait completed", { result: result === "timeout" ? "timeout" : { id: result.id, status: result.status } });
    if (result === "timeout") {
      debug("Returning timeout block response");
      const output = {
        decision: "block",
        reason: `\u5BA1\u6838\u7B49\u5F85\u8D85\u65F6\uFF08Review ID: ${review.id}\uFF09\u3002

\u5BA1\u6838\u754C\u9762\u5DF2\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00\u3002\u7528\u6237\u53EF\u80FD\u4ECD\u5728\u5BA1\u6838\u4E2D\u3002

\u8BF7\u544A\u77E5\u7528\u6237\uFF1A\u5B8C\u6210\u5BA1\u6838\u540E\uFF0C\u5728\u7EC8\u7AEF\u8F93\u5165 "continue"\uFF0C\u7136\u540E\u8C03\u7528 get_review_result \u5DE5\u5177\u83B7\u53D6\u5BA1\u6838\u7ED3\u679C\u3002`
      };
      console.log(JSON.stringify(output));
      process.exit(0);
    }
    const reviewResult = result;
    const unresolvedCount = reviewResult.comments.filter((c) => !c.resolved).length;
    debug("Processing review result", {
      isRevision,
      approvedDirectly: reviewResult.approvedDirectly,
      totalComments: reviewResult.comments.length,
      unresolvedComments: unresolvedCount
    });
    if (reviewResult.approvedDirectly || unresolvedCount === 0) {
      debug("Review approved, allowing ExitPlanMode");
      const approveResponse = {
        decision: "approve",
        reason: "\u7528\u6237\u5DF2\u5728 GUI \u4E2D\u6279\u51C6\u8BA1\u5212\u3002"
      };
      if (reviewResult.planContent) {
        approveResponse.reason = `\u7528\u6237\u5DF2\u6279\u51C6\u8BA1\u5212\u3002\u6700\u7EC8\u6279\u51C6\u7684 Plan \u5185\u5BB9\u5982\u4E0B\uFF1A

${reviewResult.planContent}`;
      }
      console.log(JSON.stringify(approveResponse));
    } else {
      debug("Review has feedback, blocking ExitPlanMode");
      const commentsText = formatComments(reviewResult.comments);
      const output = {
        decision: "block",
        reason: `\u7528\u6237\u5BF9\u8BA1\u5212\u6709\u4EE5\u4E0B\u4FEE\u6539\u5EFA\u8BAE\uFF08Review ID: ${reviewResult.id}\uFF09\uFF1A

${commentsText}

\u8BF7\u6839\u636E\u4EE5\u4E0A\u53CD\u9988\u4FEE\u6539\u8BA1\u5212\u3002\u4FEE\u6539\u65F6\u8BF7\u5728\u8BA1\u5212\u6587\u4EF6\u5F00\u5934\u6DFB\u52A0\u4EE5\u4E0B\u6807\u8BB0\uFF1A
<!-- REVIEW_ID: ${reviewResult.id} -->

\u7136\u540E\u518D\u6B21\u8C03\u7528 ExitPlanMode \u63D0\u4EA4\u4FEE\u8BA2\u7248\u672C\u3002`
      };
      console.log(JSON.stringify(output));
    }
    debug("Hook script completed successfully");
    process.exit(0);
  } catch (error) {
    debug("Hook error occurred, allowing through", { error: String(error) });
    console.error(`Hook error: ${error}`);
    console.log(JSON.stringify({ decision: "approve" }));
    process.exit(0);
  }
}
main();
