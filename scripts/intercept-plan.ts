#!/usr/bin/env node
/**
 * ExitPlanMode 拦截脚本
 * 功能：拦截 ExitPlanMode 调用，创建 review session，阻塞等待用户审核完成
 * 特性：按需启动 HTTP server（如果未运行）
 */

import http from 'http';
import net from 'net';
import { spawn } from 'child_process';
import path from 'path';

// CJS 环境下 __dirname 由 Node.js/esbuild 原生提供
declare const __dirname: string;

const SERVER_HOST = 'localhost';
const SERVER_PORT = 3030;
const POLL_INTERVAL = 2000; // 轮询间隔 2 秒
const MAX_WAIT_TIME = 570000; // 最大等待时间 570 秒（留 30 秒余量）
const SERVER_STARTUP_TIMEOUT = 10000; // 等待 server 启动的超时时间

// Debug 模式：通过环境变量控制
const DEBUG = process.env.CC_PLAN_REVIEW_DEBUG === '1' || process.env.DEBUG === '1';

// 全局 session ID（解析输入后设置，用于日志区分多实例）
let SESSION_ID = '';

// 检测端口是否有服务在监听
function isServerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(SERVER_PORT, SERVER_HOST);
  });
}

// 启动 HTTP server（独立进程）
async function startHttpServer(): Promise<boolean> {
  debug('Starting HTTP server...');

  // http-only.cjs 与当前脚本在同一目录的上一级
  const httpOnlyPath = path.join(__dirname, '..', 'http-only.cjs');
  debug('HTTP server path', { httpOnlyPath });

  return new Promise((resolve) => {
    const child = spawn('node', [httpOnlyPath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, CC_PLAN_REVIEW_DEBUG: DEBUG ? '1' : '0' }
    });

    let output = '';
    const timeoutId = setTimeout(() => {
      debug('Server startup timeout');
      child.stdout?.removeAllListeners();
      resolve(false);
    }, SERVER_STARTUP_TIMEOUT);

    child.stdout?.on('data', (data) => {
      output += data.toString();
      try {
        const result = JSON.parse(output.trim());
        clearTimeout(timeoutId);
        if (result.status === 'ready') {
          debug('HTTP server started successfully', { port: result.port });
          child.unref(); // 允许父进程退出而不等待子进程
          resolve(true);
        } else {
          debug('HTTP server failed to start', { result });
          resolve(false);
        }
      } catch {
        // 等待更多数据
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      debug('Failed to spawn HTTP server', { error: err.message });
      resolve(false);
    });
  });
}

// 确保 HTTP server 正在运行
async function ensureServerRunning(): Promise<boolean> {
  if (await isServerRunning()) {
    debug('HTTP server already running');
    return true;
  }

  debug('HTTP server not running, attempting to start...');
  const started = await startHttpServer();

  if (started) {
    // 等待一小段时间确保 server 完全就绪
    await new Promise(r => setTimeout(r, 500));
    return await isServerRunning();
  }

  return false;
}

function debug(message: string, data?: any) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  const sessionTag = SESSION_ID ? ` [${SESSION_ID.slice(0, 8)}]` : '';
  const logMessage = data !== undefined
    ? `[DEBUG ${timestamp}]${sessionTag} ${message}: ${JSON.stringify(data, null, 2)}`
    : `[DEBUG ${timestamp}]${sessionTag} ${message}`;
  console.error(logMessage);
}

// Hook 响应结构
interface HookResponse {
  decision: 'approve' | 'block';
  reason?: string;
}

// 统一响应函数：记录日志并输出 JSON 到 stdout
function respondToAgent(response: HookResponse): void {
  debug('>>> Response to agent', response);
  console.log(JSON.stringify(response));
}

interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: {
    plan?: string;
    summary?: string;
    [key: string]: any;
  };
  tool_use_id: string;
}

interface Review {
  id: string;
  status: 'open' | 'changes_requested' | 'discussing' | 'approved' | 'updated';
  comments: Array<{
    quote: string;
    comment: string;
    resolved?: boolean;
  }>;
  approvedDirectly?: boolean;
  planContent?: string;  // 最终批准的 plan 内容
}

// 从 plan 内容中提取 REVIEW_ID 标记
function extractReviewId(planContent: string): string | null {
  // 匹配 <!-- REVIEW_ID: xxx --> 格式
  const match = planContent.match(/<!--\s*REVIEW_ID:\s*([a-f0-9-]+)\s*-->/i);
  return match ? match[1] : null;
}

// 从 plan 内容中移除 REVIEW_ID 标记
function removeReviewIdMarker(planContent: string): string {
  return planContent.replace(/<!--\s*REVIEW_ID:\s*[a-f0-9-]+\s*-->\n?/gi, '');
}

// HTTP 请求封装
function httpRequest(options: http.RequestOptions, postData?: string): Promise<any> {
  debug('httpRequest', { method: options.method, path: options.path, postDataLength: postData?.length });
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = { statusCode: res.statusCode, data: JSON.parse(data) };
          debug('httpRequest response', { statusCode: res.statusCode, dataKeys: Object.keys(result.data || {}) });
          resolve(result);
        } catch {
          debug('httpRequest response (non-JSON)', { statusCode: res.statusCode });
          resolve({ statusCode: res.statusCode, data: null });
        }
      });
    });
    req.on('error', (err) => {
      debug('httpRequest error', { error: err.message });
      reject(err);
    });
    req.setTimeout(5000, () => {
      debug('httpRequest timeout');
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (postData) req.write(postData);
    req.end();
  });
}

// 创建 review session
async function createReview(plan: string, projectPath: string): Promise<Review> {
  debug('createReview', { planLength: plan.length, projectPath });
  const postData = JSON.stringify({ plan, projectPath });
  const result = await httpRequest({
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    path: '/api/reviews',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);

  if (result.statusCode !== 200 || !result.data) {
    throw new Error('Failed to create review session');
  }
  return result.data;
}

// 更新已有 review 的 plan 内容（提交修订版本）
async function updateReviewPlan(reviewId: string, plan: string): Promise<Review> {
  debug('updateReviewPlan', { reviewId, planLength: plan.length });
  const postData = JSON.stringify({
    content: plan,
    author: 'agent',
    changeDescription: '根据审核反馈修订'
  });
  const result = await httpRequest({
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    path: `/api/reviews/${reviewId}/plan`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);

  if (result.statusCode !== 200 || !result.data) {
    throw new Error(`Failed to update review: ${result.data?.error || 'Unknown error'}`);
  }
  return result.data;
}

// 获取 review 状态
async function getReview(reviewId: string): Promise<Review | null> {
  try {
    const result = await httpRequest({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: `/api/reviews/${reviewId}`,
      method: 'GET'
    });
    return result.statusCode === 200 ? result.data : null;
  } catch {
    return null;
  }
}

// 使用 SSE 等待 review 完成
function waitForReviewWithSSE(reviewId: string, timeout: number): Promise<Review | 'timeout'> {
  debug('waitForReviewWithSSE', { reviewId, timeout });
  return new Promise((resolve) => {
    const startTime = Date.now();
    let resolved = false;

    // SSE 连接
    debug('SSE connecting', { path: `/api/reviews/${reviewId}/events` });
    const req = http.get({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: `/api/reviews/${reviewId}/events`,
      headers: { 'Accept': 'text/event-stream' }
    }, (res) => {
      debug('SSE connected', { statusCode: res.statusCode });
      let currentEventType = '';

      res.on('data', (chunk: Buffer) => {
        if (resolved) return;

        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          // 解析 event: 行获取事件类型
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          // 解析 data: 行获取数据
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              // 过滤 heartbeat 日志
              if (currentEventType !== 'heartbeat') {
                debug('SSE event received', { type: currentEventType, data });
              }
              // 处理 approved 和 changes_requested 两种状态
              if (currentEventType === 'status_changed' &&
                  (data.status === 'approved' || data.status === 'changes_requested')) {
                debug(`Review status changed to ${data.status} via SSE`);
                resolved = true;
                req.destroy();
                // 获取最新的 review 数据
                getReview(reviewId).then(review => {
                  resolve(review || 'timeout');
                });
                return;
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      });
    });

    req.on('error', (err) => {
      debug('SSE error, falling back to polling', { error: (err as Error).message });
      // SSE 失败时回退到轮询
      if (!resolved) {
        resolved = true;
        pollForReview(reviewId, timeout - (Date.now() - startTime)).then(resolve);
      }
    });

    // 超时处理
    setTimeout(() => {
      if (!resolved) {
        debug('waitForReviewWithSSE timeout');
        resolved = true;
        req.destroy();
        resolve('timeout');
      }
    }, timeout);
  });
}

// 轮询等待 review 完成（SSE 失败时的回退方案）
async function pollForReview(reviewId: string, timeout: number): Promise<Review | 'timeout'> {
  debug('pollForReview started', { reviewId, timeout });
  const startTime = Date.now();
  let pollCount = 0;

  while (Date.now() - startTime < timeout) {
    pollCount++;
    debug('pollForReview polling', { pollCount, elapsed: Date.now() - startTime });
    const review = await getReview(reviewId);
    // 处理 approved 和 changes_requested 两种状态
    if (review && (review.status === 'approved' || review.status === 'changes_requested')) {
      debug(`pollForReview: review status is ${review.status}`, { pollCount });
      return review;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  debug('pollForReview timeout', { pollCount });
  return 'timeout';
}

// 根据偏移量计算行号
function calculateLineNumber(content: string, offset: number): number {
  const textBefore = content.substring(0, offset);
  return (textBefore.match(/\n/g) || []).length + 1;
}

// 判断是否为全局性批注
function isGlobalComment(item: Review['comments'][0]): boolean {
  return !item.quote || (item.position?.startOffset === 0 && item.position?.endOffset === 0);
}

// 格式化评论反馈（含行号和偏移量，区分普通批注和全局性批注）
function formatComments(comments: Review['comments'], planContent: string): string {
  const unresolvedComments = comments.filter(c => !c.resolved);
  if (unresolvedComments.length === 0) return '';

  // 分离普通批注和全局性批注
  const lineComments = unresolvedComments.filter(c => !isGlobalComment(c));
  const globalComments = unresolvedComments.filter(c => isGlobalComment(c));

  let result = '';

  // 格式化普通批注（带行号）
  if (lineComments.length > 0) {
    result = lineComments.map((item, index) => {
      const pos = item.position;
      const startLine = calculateLineNumber(planContent, pos.startOffset);
      const endLine = calculateLineNumber(planContent, pos.endOffset);

      const lineInfo = startLine === endLine ? `行 ${startLine}` : `行 ${startLine}-${endLine}`;
      const offsetInfo = `偏移 ${pos.startOffset}-${pos.endOffset}`;

      return `${index + 1}. [${lineInfo}, ${offsetInfo}, 引用: "${item.quote}"] → 评论: ${item.comment}`;
    }).join('\n');
  }

  // 格式化全局性批注（单独说明）
  if (globalComments.length > 0) {
    if (result) result += '\n\n';
    result += '**全局性审核意见**:\n';
    result += globalComments.map((item, index) => `${index + 1}. ${item.comment}`).join('\n');
  }

  return result;
}

// 主函数
async function main() {
  debug('Hook script started');
  let inputData = '';

  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  debug('Received stdin input', { length: inputData.length });

  try {
    const input: HookInput = JSON.parse(inputData);
    SESSION_ID = input.session_id || '';
    debug('Parsed hook input', {
      tool_name: input.tool_name,
      hook_event_name: input.hook_event_name,
      cwd: input.cwd,
      session_id: input.session_id,
      tool_input_keys: Object.keys(input.tool_input || {})
    });

    // 只处理 ExitPlanMode
    if (input.tool_name !== 'ExitPlanMode') {
      debug('Skipping non-ExitPlanMode tool');
      respondToAgent({ decision: 'approve' });
      process.exit(0);
    }

    // 提取 plan 内容
    const rawPlanContent = input.tool_input?.plan || input.tool_input?.summary || 'Plan review requested';
    debug('Raw plan content extracted', { planContentLength: rawPlanContent.length });

    // 检查是否包含 REVIEW_ID 标记（修订版本）
    const existingReviewId = extractReviewId(rawPlanContent);
    const planContent = existingReviewId ? removeReviewIdMarker(rawPlanContent) : rawPlanContent;
    debug('Review ID check', { existingReviewId, cleanPlanLength: planContent.length });

    let review: Review;
    let isRevision = false;

    // 确保 HTTP server 正在运行（在任何操作之前）
    const serverRunning = await ensureServerRunning();
    if (!serverRunning) {
      debug('HTTP server not available, allowing through');
      console.error('HTTP server not available');
      respondToAgent({ decision: 'approve' });
      process.exit(0);
    }

    if (existingReviewId) {
      // 修订版本：更新已有 review
      debug('Revision detected, updating existing review', { reviewId: existingReviewId });
      try {
        // 先验证 review 是否存在
        const existingReview = await getReview(existingReviewId);
        if (!existingReview) {
          throw new Error(`Review ${existingReviewId} not found`);
        }
        // 更新 plan 内容
        review = await updateReviewPlan(existingReviewId, planContent);
        isRevision = true;
        debug('Review updated successfully', { reviewId: review.id, status: review.status });
      } catch (error) {
        // 更新失败，回退到创建新 review
        debug('Failed to update review, creating new one', { error: String(error) });
        review = await createReview(planContent, input.cwd);
        debug('New review created as fallback', { reviewId: review.id });
      }
    } else {
      // 首次提交：创建新 review
      try {
        review = await createReview(planContent, input.cwd);
        debug('New review session created', { reviewId: review.id, status: review.status });
      } catch (error) {
        // 服务器不可用时，允许通过
        debug('Failed to create review, allowing through', { error: String(error) });
        console.error(`Failed to create review: ${error}`);
        respondToAgent({ decision: 'approve' });
        process.exit(0);
      }
    }

    // 等待用户审核完成
    debug('Waiting for review completion');
    const result = await waitForReviewWithSSE(review.id, MAX_WAIT_TIME);
    debug('Review wait completed', { result: result === 'timeout' ? 'timeout' : { id: result.id, status: result.status } });

    if (result === 'timeout') {
      // 超时，返回 deny 并告知用户手动继续
      debug('Returning timeout block response');
      respondToAgent({
        decision: 'block',
        reason: `审核等待超时（Review ID: ${review.id}）。

审核界面已在浏览器中打开。用户可能仍在审核中。

请告知用户：完成审核后，在终端输入 "continue"，然后调用 get_review_result 工具获取审核结果。`
      });
      process.exit(0);
    }

    // 审核完成
    const reviewResult = result as Review;
    const unresolvedCount = reviewResult.comments.filter(c => !c.resolved).length;
    debug('Processing review result', {
      isRevision,
      approvedDirectly: reviewResult.approvedDirectly,
      totalComments: reviewResult.comments.length,
      unresolvedComments: unresolvedCount
    });

    if (reviewResult.approvedDirectly || unresolvedCount === 0) {
      // 用户直接批准，允许 ExitPlanMode 执行
      debug('Review approved, allowing ExitPlanMode');

      // 构建批准指令
      let reason = `用户已批准计划。

**重要指令**：
1. 退出 Plan Mode
2. 切换到 Auto Accept Mode（自动接受编辑模式）
3. 按照计划开始执行`;

      // 如果有 planContent，附加到 reason 中
      if (reviewResult.planContent) {
        reason += `\n\n**最终批准的 Plan 内容**：\n\n${reviewResult.planContent}`;
      }

      respondToAgent({ decision: 'approve', reason });
    } else {
      // 用户有反馈，阻止并返回评论
      debug('Review has feedback, blocking ExitPlanMode');
      const commentsText = formatComments(reviewResult.comments, reviewResult.planContent || '');
      respondToAgent({
        decision: 'block',
        reason: `用户对计划有以下修改建议（Review ID: ${reviewResult.id}）：

${commentsText}

请根据以上反馈修改计划。修改时请在计划文件开头添加以下标记：
<!-- REVIEW_ID: ${reviewResult.id} -->

然后再次调用 ExitPlanMode 提交修订版本。`
      });
    }

    debug('Hook script completed successfully');
    process.exit(0);

  } catch (error) {
    // 出错时允许通过，避免阻塞用户
    debug('Hook error occurred, allowing through', { error: String(error) });
    console.error(`Hook error: ${error}`);
    respondToAgent({ decision: 'approve' });
    process.exit(0);
  }
}

main();
