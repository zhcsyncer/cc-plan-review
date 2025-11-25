import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'crypto';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../.reviews'); // Adjusted path since we are in src/

// Ensure data dir exists
try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    logger.info(`Data directory initialized at ${DATA_DIR}`);
} catch (e) {
    // ignore if exists
    logger.debug(`Data directory already exists at ${DATA_DIR}`);
}

// 位置信息接口
export interface TextPosition {
  startOffset: number;      // 选中文本的起始字符偏移量
  endOffset: number;        // 选中文本的结束字符偏移量
  startLine?: number;       // （可选）起始行号，辅助定位
  endLine?: number;         // （可选）结束行号
}

// 文档版本接口
export interface DocumentVersion {
  versionHash: string;      // 文档内容的哈希值
  content: string;          // 文档内容快照
  createdAt: number;
  changeDescription?: string;  // 变更描述
  author?: 'human' | 'agent';  // 版本作者
  previousVersion?: string;    // 上一版本哈希（用于回滚追踪）
  changes?: DiffChange[];   // 与上一版本的差异（可选）
}

// 版本摘要接口（不含内容，用于列表展示）
export interface VersionSummary {
  versionHash: string;
  createdAt: number;
  changeDescription?: string;
  author?: 'human' | 'agent';
  isCurrent: boolean;
}

// Diff 行接口
export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

// Diff 结果接口
export interface DiffResult {
  fromVersion: string;
  toVersion: string;
  lines: DiffLine[];
  stats: {
    additions: number;
    deletions: number;
    unchanged: number;
  };
}

// 差异变更接口
export interface DiffChange {
  type: 'insert' | 'delete' | 'modify';
  startOffset: number;
  endOffset: number;
  oldText?: string;
  newText?: string;
}

// Agent 针对 Comment 的问题
export interface CommentQuestion {
  type: 'clarification' | 'choice' | 'accepted';
  message: string;                // Agent 的问题/说明
  options?: string[];             // choice 类型时的选项
}

export interface Comment {
  id: string;
  createdAt: number;
  quote: string;              // 引用文本（保留用于显示）
  comment: string;            // 评论内容

  // 位置信息
  position: TextPosition;

  // 版本追踪
  documentVersion: string;    // 关联的文档版本哈希
  originalPosition?: TextPosition;  // 原始位置（用于版本迁移失败时回退）
  positionStatus: 'valid' | 'adjusted' | 'stale';  // 位置状态

  // Question 相关字段
  question?: CommentQuestion;     // Agent 提出的问题
  answer?: string;                // 用户的回答

  // 解决状态
  resolved: boolean;
  resolvedAt?: number;
  resolvedInVersion?: string;
  resolution?: string;            // 解决说明
}

// Review 状态枚举
export type ReviewStatus =
  | 'pending'            // 初始状态：等待用户审阅
  | 'submitted_feedback' // 用户提交了反馈，等待 Agent 处理
  | 'questions_pending'  // Agent 提出了 questions，等待用户回答
  | 'approved'           // 用户批准通过（终态）
  | 'revised';           // Agent 提交了修订版本，等待用户再次审阅

export interface Review {
  id: string;
  createdAt: number;
  status: ReviewStatus;
  planContent: string;
  comments: Comment[];

  // 版本管理
  documentVersions: DocumentVersion[];  // 文档版本历史
  currentVersion: string;               // 当前版本哈希
}

export class ReviewManager {
  // 计算文档内容的哈希值
  private calculateContentHash(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  async _save(review: Review): Promise<void> {
    const filePath = path.join(DATA_DIR, `${review.id}.json`);
    await fs.writeFile(
      filePath,
      JSON.stringify(review, null, 2)
    );
    logger.debug(`Saved review ${review.id} to ${filePath}`);
  }

  async getReview(id: string): Promise<Review | null> {
    try {
      const data = await fs.readFile(path.join(DATA_DIR, `${id}.json`), 'utf-8');
      return JSON.parse(data) as Review;
    } catch (e) {
      logger.warn(`Failed to load review ${id}: ${(e as Error).message}`);
      return null;
    }
  }

  async getLatestReview(): Promise<Review | null> {
    try {
      const files = await fs.readdir(DATA_DIR);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      if (jsonFiles.length === 0) return null;

      let latestFile: string | null = null;
      let maxTime = 0;

      for (const file of jsonFiles) {
        const stats = await fs.stat(path.join(DATA_DIR, file));
        if (stats.mtimeMs > maxTime) {
          maxTime = stats.mtimeMs;
          latestFile = file;
        }
      }

      if (!latestFile) return null;
      return this.getReview(latestFile.replace('.json', ''));
    } catch (e) {
      logger.error("Error getting latest review:", e);
      return null;
    }
  }

  async createReview(plan: string): Promise<Review> {
    const id = randomUUID();
    const versionHash = this.calculateContentHash(plan);
    logger.info(`Creating new review with ID: ${id}, version: ${versionHash}`);

    const initialVersion: DocumentVersion = {
      versionHash,
      content: plan,
      createdAt: Date.now()
    };

    const review: Review = {
      id,
      createdAt: Date.now(),
      status: 'pending',
      planContent: plan,
      comments: [],
      documentVersions: [initialVersion],
      currentVersion: versionHash
    };
    await this._save(review);
    return review;
  }

  async addComment(
    reviewId: string,
    commentData: {
      quote: string;
      comment: string;
      position: TextPosition;
    }
  ): Promise<Comment> {
    const review = await this.getReview(reviewId);
    if (!review) {
        logger.error(`Add comment failed: Review ${reviewId} not found`);
        throw new Error('Review not found');
    }

    const comment: Comment = {
      id: randomUUID(),
      createdAt: Date.now(),
      quote: commentData.quote,
      comment: commentData.comment,
      position: commentData.position,
      documentVersion: review.currentVersion,
      positionStatus: 'valid',
      resolved: false
    };
    review.comments.push(comment);
    await this._save(review);
    logger.info(`Added comment to review ${reviewId}: ${comment.id} at offset ${commentData.position.startOffset}-${commentData.position.endOffset}`);
    return comment;
  }

  async updateComment(reviewId: string, commentId: string, text: string): Promise<Comment | undefined> {
    const review = await this.getReview(reviewId);
    if (!review) {
        logger.error(`Update comment failed: Review ${reviewId} not found`);
        throw new Error('Review not found');
    }

    const comment = review.comments.find(c => c.id === commentId);
    if (comment) {
      comment.comment = text;
      await this._save(review);
      logger.info(`Updated comment ${commentId} in review ${reviewId}`);
    } else {
      logger.warn(`Update comment failed: Comment ${commentId} not found in review ${reviewId}`);
    }
    return comment;
  }

  async deleteComment(reviewId: string, commentId: string): Promise<void> {
    const review = await this.getReview(reviewId);
    if (!review) {
        logger.error(`Delete comment failed: Review ${reviewId} not found`);
        throw new Error('Review not found');
    }

    review.comments = review.comments.filter(c => c.id !== commentId);
    await this._save(review);
    logger.info(`Deleted comment ${commentId} from review ${reviewId}`);
  }

  // 用户提交反馈（有批注）
  async submitFeedback(reviewId: string): Promise<Review> {
    const review = await this.getReview(reviewId);
    if (!review) {
        logger.error(`Submit feedback failed: Review ${reviewId} not found`);
        throw new Error('Review not found');
    }

    // 验证状态转换合法性
    if (review.status !== 'pending' && review.status !== 'revised' && review.status !== 'questions_pending') {
        logger.error(`Submit feedback failed: Invalid status transition from ${review.status}`);
        throw new Error(`Cannot submit feedback from status: ${review.status}`);
    }

    // 检查是否有未解决的 comments
    const hasUnresolvedComments = review.comments.some(c => !c.resolved);
    if (!hasUnresolvedComments) {
        logger.warn(`Submit feedback: No unresolved comments, consider using approveReview instead`);
    }

    review.status = 'submitted_feedback';
    await this._save(review);
    logger.info(`Submitted feedback for review ${reviewId}`);
    return review;
  }

  // 用户直接通过（无批注或接受修改）
  async approveReview(reviewId: string): Promise<Review> {
    const review = await this.getReview(reviewId);
    if (!review) {
        logger.error(`Approve review failed: Review ${reviewId} not found`);
        throw new Error('Review not found');
    }

    // 验证状态转换合法性
    if (review.status !== 'pending' && review.status !== 'revised') {
        logger.error(`Approve review failed: Invalid status transition from ${review.status}`);
        throw new Error(`Cannot approve from status: ${review.status}`);
    }

    review.status = 'approved';
    await this._save(review);
    logger.info(`Approved review ${reviewId}`);
    return review;
  }

  // Agent 提交 questions
  async askQuestions(
    reviewId: string,
    questions: Array<{
      commentId: string;
      type: 'clarification' | 'choice' | 'accepted';
      message: string;
      options?: string[];
    }>
  ): Promise<Review> {
    const review = await this.getReview(reviewId);
    if (!review) {
        logger.error(`Ask questions failed: Review ${reviewId} not found`);
        throw new Error('Review not found');
    }

    // 验证状态
    if (review.status !== 'submitted_feedback') {
        logger.error(`Ask questions failed: Invalid status ${review.status}, expected submitted_feedback`);
        throw new Error(`Cannot ask questions from status: ${review.status}`);
    }

    // 验证所有 comments 都被覆盖
    const unresolvedCommentIds = review.comments.filter(c => !c.resolved).map(c => c.id);
    const questionCommentIds = questions.map(q => q.commentId);
    const missingComments = unresolvedCommentIds.filter(id => !questionCommentIds.includes(id));

    if (missingComments.length > 0) {
        logger.error(`Ask questions failed: Missing questions for comments: ${missingComments.join(', ')}`);
        throw new Error(`Must provide questions for all unresolved comments. Missing: ${missingComments.join(', ')}`);
    }

    // 应用 questions 到 comments
    for (const q of questions) {
      const comment = review.comments.find(c => c.id === q.commentId);
      if (!comment) {
        logger.warn(`Ask questions: Comment ${q.commentId} not found, skipping`);
        continue;
      }

      comment.question = {
        type: q.type,
        message: q.message,
        options: q.options
      };

      // 如果是 accepted 类型，直接标记为已解决
      if (q.type === 'accepted') {
        comment.resolved = true;
        comment.resolvedAt = Date.now();
        comment.resolution = q.message;
      }
    }

    review.status = 'questions_pending';
    await this._save(review);
    logger.info(`Asked questions for review ${reviewId}, ${questions.length} questions`);
    return review;
  }

  // 用户回答 question
  async answerQuestion(reviewId: string, commentId: string, answer: string): Promise<Comment | undefined> {
    const review = await this.getReview(reviewId);
    if (!review) {
        logger.error(`Answer question failed: Review ${reviewId} not found`);
        throw new Error('Review not found');
    }

    const comment = review.comments.find(c => c.id === commentId);
    if (!comment) {
      logger.warn(`Answer question: Comment ${commentId} not found`);
      return undefined;
    }

    if (!comment.question) {
      logger.warn(`Answer question: Comment ${commentId} has no question`);
      return undefined;
    }

    comment.answer = answer;
    await this._save(review);
    logger.info(`Answered question for comment ${commentId} in review ${reviewId}`);
    return comment;
  }

  // 更新 Plan 内容并创建新版本
  async updatePlanContent(
    reviewId: string,
    newContent: string,
    options?: {
      changeDescription?: string;
      author?: 'human' | 'agent';
      resolvedComments?: Array<{
        commentId: string;
        resolution: string;
      }>;
    }
  ): Promise<Review> {
    const review = await this.getReview(reviewId);
    if (!review) {
        logger.error(`Update plan failed: Review ${reviewId} not found`);
        throw new Error('Review not found');
    }

    // Agent 提交新版本时验证状态
    if (options?.author === 'agent' && review.status !== 'submitted_feedback') {
        logger.error(`Update plan failed: Agent can only update when status is submitted_feedback, current: ${review.status}`);
        throw new Error(`Agent cannot update plan from status: ${review.status}`);
    }

    const newVersionHash = this.calculateContentHash(newContent);

    // 如果内容没有变化，直接返回
    if (newVersionHash === review.currentVersion) {
      logger.debug(`Plan content unchanged for review ${reviewId}`);
      return review;
    }

    // 创建新版本
    const newVersion: DocumentVersion = {
      versionHash: newVersionHash,
      content: newContent,
      createdAt: Date.now(),
      changeDescription: options?.changeDescription,
      author: options?.author || 'agent',
      previousVersion: review.currentVersion
    };

    review.documentVersions.push(newVersion);
    review.currentVersion = newVersionHash;
    review.planContent = newContent;

    // 处理已解决的 comments
    if (options?.resolvedComments) {
      for (const rc of options.resolvedComments) {
        const comment = review.comments.find(c => c.id === rc.commentId);
        if (comment) {
          comment.resolved = true;
          comment.resolvedAt = Date.now();
          comment.resolvedInVersion = newVersionHash;
          comment.resolution = rc.resolution;
        }
      }
    }

    // Agent 更新时自动转为 revised 状态
    if (options?.author === 'agent' && review.status === 'submitted_feedback') {
      review.status = 'revised';
      logger.info(`Review ${reviewId} status changed to revised`);
    }

    // TODO: 调整评论位置（在 Phase 5 实现）
    // await this.adjustCommentPositions(review);

    await this._save(review);
    logger.info(`Updated plan content for review ${reviewId}, new version: ${newVersionHash}`);
    return review;
  }

  // 获取指定版本的文档内容
  getDocumentVersion(review: Review, versionHash: string): DocumentVersion | undefined {
    return review.documentVersions.find(v => v.versionHash === versionHash);
  }

  // 获取版本列表（不含内容，用于列表展示）
  getVersionList(review: Review): VersionSummary[] {
    return review.documentVersions.map(v => ({
      versionHash: v.versionHash,
      createdAt: v.createdAt,
      changeDescription: v.changeDescription,
      author: v.author,
      isCurrent: v.versionHash === review.currentVersion
    }));
  }

  // 计算两个版本之间的差异
  computeDiff(review: Review, fromHash: string, toHash: string): DiffResult | null {
    const fromVersion = this.getDocumentVersion(review, fromHash);
    const toVersion = this.getDocumentVersion(review, toHash);

    if (!fromVersion || !toVersion) {
      logger.warn(`computeDiff: Version not found (from: ${fromHash}, to: ${toHash})`);
      return null;
    }

    const fromLines = fromVersion.content.split('\n');
    const toLines = toVersion.content.split('\n');

    // 使用简单的 LCS (Longest Common Subsequence) 算法计算 diff
    const diffLines = this.computeLCSDiff(fromLines, toLines);

    const stats = {
      additions: diffLines.filter(l => l.type === 'added').length,
      deletions: diffLines.filter(l => l.type === 'removed').length,
      unchanged: diffLines.filter(l => l.type === 'unchanged').length
    };

    return {
      fromVersion: fromHash,
      toVersion: toHash,
      lines: diffLines,
      stats
    };
  }

  // LCS diff 算法
  private computeLCSDiff(oldLines: string[], newLines: string[]): DiffLine[] {
    const m = oldLines.length;
    const n = newLines.length;

    // 构建 LCS 表
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // 回溯构建 diff
    const result: DiffLine[] = [];
    let i = m, j = n;
    const temp: DiffLine[] = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        temp.push({
          type: 'unchanged',
          content: oldLines[i - 1],
          oldLineNumber: i,
          newLineNumber: j
        });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        temp.push({
          type: 'added',
          content: newLines[j - 1],
          newLineNumber: j
        });
        j--;
      } else {
        temp.push({
          type: 'removed',
          content: oldLines[i - 1],
          oldLineNumber: i
        });
        i--;
      }
    }

    // 反转得到正确顺序
    return temp.reverse();
  }

  // 回滚到指定版本（创建新版本而非覆盖历史）
  async rollbackToVersion(reviewId: string, targetVersionHash: string): Promise<Review> {
    const review = await this.getReview(reviewId);
    if (!review) {
      logger.error(`Rollback failed: Review ${reviewId} not found`);
      throw new Error('Review not found');
    }

    const targetVersion = this.getDocumentVersion(review, targetVersionHash);
    if (!targetVersion) {
      logger.error(`Rollback failed: Version ${targetVersionHash} not found`);
      throw new Error('Version not found');
    }

    // 创建新版本（内容与目标版本相同）
    return this.updatePlanContent(reviewId, targetVersion.content, {
      changeDescription: `Rollback to version ${targetVersionHash.substring(0, 8)}`,
      author: 'human'
    });
  }
}
