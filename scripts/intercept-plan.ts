#!/usr/bin/env node
/**
 * ExitPlanMode 拦截脚本
 * 功能：拦截 ExitPlanMode 调用，创建 review session，阻塞等待用户审核完成
 */

import http from 'http';

const SERVER_HOST = 'localhost';
const SERVER_PORT = 3030;
const POLL_INTERVAL = 2000; // 轮询间隔 2 秒
const MAX_WAIT_TIME = 570000; // 最大等待时间 570 秒（留 30 秒余量）

// Debug 模式：通过环境变量控制
const DEBUG = process.env.CC_PLAN_REVIEW_DEBUG === '1' || process.env.DEBUG === '1';

function debug(message: string, data?: any) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  const logMessage = data !== undefined
    ? `[DEBUG ${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}`
    : `[DEBUG ${timestamp}] ${message}`;
  console.error(logMessage);
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
              debug('SSE event received', { type: currentEventType, data });
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

// 格式化评论反馈
function formatComments(comments: Review['comments']): string {
  const unresolvedComments = comments.filter(c => !c.resolved);
  if (unresolvedComments.length === 0) return '';

  return unresolvedComments.map((item, index) => {
    return `${index + 1}. [引用: "${item.quote}"] → 评论: ${item.comment}`;
  }).join('\n');
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
      console.log(JSON.stringify({ decision: 'approve' }));
      process.exit(0);
    }

    // 提取 plan 内容 - ExitPlanMode 没有参数，需要从其他地方获取计划内容
    // 实际上 ExitPlanMode 是无参数的，计划内容应该从 Plan 文件读取
    // 这里我们创建一个空的 review，让用户在浏览器中查看
    const planContent = input.tool_input?.plan || input.tool_input?.summary || 'Plan review requested';
    debug('Plan content extracted', { planContentLength: planContent.length });

    // 创建 review session
    let review: Review;
    try {
      review = await createReview(planContent, input.cwd);
      debug('Review session created', { reviewId: review.id, status: review.status });
    } catch (error) {
      // 服务器不可用时，允许通过
      debug('Failed to create review, allowing through', { error: String(error) });
      console.error(`Failed to create review: ${error}`);
      console.log(JSON.stringify({ decision: 'approve' }));
      process.exit(0);
    }

    // 等待用户审核完成
    debug('Waiting for review completion');
    const result = await waitForReviewWithSSE(review.id, MAX_WAIT_TIME);
    debug('Review wait completed', { result: result === 'timeout' ? 'timeout' : { id: result.id, status: result.status } });

    if (result === 'timeout') {
      // 超时，返回 deny 并告知用户手动继续
      debug('Returning timeout block response');
      const output = {
        decision: 'block',
        reason: `审核等待超时（Review ID: ${review.id}）。

审核界面已在浏览器中打开。用户可能仍在审核中。

请告知用户：完成审核后，在终端输入 "continue"，然后调用 get_review_result 工具获取审核结果。`
      };
      console.log(JSON.stringify(output));
      process.exit(0);
    }

    // 审核完成
    const reviewResult = result as Review;
    const unresolvedCount = reviewResult.comments.filter(c => !c.resolved).length;
    debug('Processing review result', {
      approvedDirectly: reviewResult.approvedDirectly,
      totalComments: reviewResult.comments.length,
      unresolvedComments: unresolvedCount
    });

    if (reviewResult.approvedDirectly || unresolvedCount === 0) {
      // 用户直接批准，允许 ExitPlanMode 执行
      debug('Review approved, allowing ExitPlanMode');
      console.log(JSON.stringify({
        decision: 'approve',
        reason: '用户已在 GUI 中批准计划。'
      }));
    } else {
      // 用户有反馈，阻止并返回评论
      debug('Review has feedback, blocking ExitPlanMode');
      const commentsText = formatComments(reviewResult.comments);
      const output = {
        decision: 'block',
        reason: `用户对计划有以下修改建议（Review ID: ${reviewResult.id}）：

${commentsText}

请根据以上反馈修改计划，然后再次调用 ExitPlanMode 提交修改后的计划。修改后用户的浏览器会自动刷新显示新版本。`
      };
      console.log(JSON.stringify(output));
    }

    debug('Hook script completed successfully');
    process.exit(0);

  } catch (error) {
    // 出错时允许通过，避免阻塞用户
    debug('Hook error occurred, allowing through', { error: String(error) });
    console.error(`Hook error: ${error}`);
    console.log(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }
}

main();
