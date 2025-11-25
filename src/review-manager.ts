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
}

export interface Review {
  id: string;
  createdAt: number;
  status: 'pending' | 'submitted';
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
      positionStatus: 'valid'
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

  async submitReview(reviewId: string): Promise<Review> {
    const review = await this.getReview(reviewId);
    if (!review) {
        logger.error(`Submit review failed: Review ${reviewId} not found`);
        throw new Error('Review not found');
    }

    review.status = 'submitted';
    await this._save(review);
    logger.info(`Submitted review ${reviewId}`);
    return review;
  }

  // 更新 Plan 内容并创建新版本
  async updatePlanContent(
    reviewId: string,
    newContent: string,
    options?: {
      changeDescription?: string;
      author?: 'human' | 'agent';
    }
  ): Promise<Review> {
    const review = await this.getReview(reviewId);
    if (!review) {
        logger.error(`Update plan failed: Review ${reviewId} not found`);
        throw new Error('Review not found');
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
