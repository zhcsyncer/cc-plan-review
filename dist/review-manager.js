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
}
catch (e) {
    // ignore if exists
    logger.debug(`Data directory already exists at ${DATA_DIR}`);
}
// 项目路径编码函数
function encodeProjectPath(projectPath) {
    return projectPath
        .replace(/^\//, '') // 移除开头的 /
        .replace(/\//g, '_') // 替换 / 为 _
        .replace(/:/g, '_'); // 替换 : 为 _ (Windows 盘符)
}
function getProjectDataDir(projectPath) {
    const encoded = encodeProjectPath(projectPath);
    return path.join(DATA_DIR, 'projects', encoded);
}
export class ReviewManager {
    // 计算文档内容的哈希值
    calculateContentHash(content) {
        return createHash('sha256').update(content, 'utf-8').digest('hex');
    }
    // 确保项目数据目录存在
    async ensureProjectDir(projectPath) {
        const dir = getProjectDataDir(projectPath);
        await fs.mkdir(dir, { recursive: true });
        return dir;
    }
    async _save(review) {
        const dir = review.projectPath
            ? await this.ensureProjectDir(review.projectPath)
            : DATA_DIR;
        const filePath = path.join(dir, `${review.id}.json`);
        await fs.writeFile(filePath, JSON.stringify(review, null, 2));
        logger.debug(`Saved review ${review.id} to ${filePath}`);
    }
    async getReview(id, projectPath) {
        // 在指定项目目录查找
        if (projectPath) {
            const dir = getProjectDataDir(projectPath);
            try {
                const data = await fs.readFile(path.join(dir, `${id}.json`), 'utf-8');
                return JSON.parse(data);
            }
            catch (e) {
                logger.warn(`Failed to load review ${id} from project ${projectPath}: ${e.message}`);
                return null;
            }
        }
        // 在全局目录查找
        try {
            const data = await fs.readFile(path.join(DATA_DIR, `${id}.json`), 'utf-8');
            return JSON.parse(data);
        }
        catch {
            // 继续搜索项目目录
        }
        // 搜索所有项目目录
        try {
            const projectsDir = path.join(DATA_DIR, 'projects');
            const projects = await fs.readdir(projectsDir);
            for (const project of projects) {
                try {
                    const filePath = path.join(projectsDir, project, `${id}.json`);
                    const data = await fs.readFile(filePath, 'utf-8');
                    return JSON.parse(data);
                }
                catch {
                    // 继续搜索下一个项目
                }
            }
        }
        catch {
            // projects 目录不存在
        }
        logger.warn(`Failed to load review ${id}: not found in any location`);
        return null;
    }
    async getLatestReview(projectPath) {
        const searchDir = projectPath ? getProjectDataDir(projectPath) : DATA_DIR;
        try {
            await fs.access(searchDir);
        }
        catch {
            return null;
        }
        try {
            const files = await fs.readdir(searchDir);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            if (jsonFiles.length === 0)
                return null;
            let latestFile = null;
            let maxTime = 0;
            for (const file of jsonFiles) {
                const stats = await fs.stat(path.join(searchDir, file));
                if (stats.mtimeMs > maxTime) {
                    maxTime = stats.mtimeMs;
                    latestFile = file;
                }
            }
            if (!latestFile)
                return null;
            return this.getReview(latestFile.replace('.json', ''), projectPath);
        }
        catch (e) {
            logger.error("Error getting latest review:", e);
            return null;
        }
    }
    async createReview(plan, projectPath) {
        const id = randomUUID();
        const versionHash = this.calculateContentHash(plan);
        logger.info(`Creating new review with ID: ${id}, version: ${versionHash}, project: ${projectPath || 'global'}`);
        const initialVersion = {
            versionHash,
            content: plan,
            createdAt: Date.now()
        };
        const review = {
            id,
            createdAt: Date.now(),
            status: 'open',
            planContent: plan,
            comments: [],
            documentVersions: [initialVersion],
            currentVersion: versionHash,
            projectPath
        };
        await this._save(review);
        return review;
    }
    async addComment(reviewId, commentData) {
        const review = await this.getReview(reviewId);
        if (!review) {
            logger.error(`Add comment failed: Review ${reviewId} not found`);
            throw new Error('Review not found');
        }
        const comment = {
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
    async updateComment(reviewId, commentId, text) {
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
        }
        else {
            logger.warn(`Update comment failed: Comment ${commentId} not found in review ${reviewId}`);
        }
        return comment;
    }
    async deleteComment(reviewId, commentId) {
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
    async submitFeedback(reviewId) {
        const review = await this.getReview(reviewId);
        if (!review) {
            logger.error(`Submit feedback failed: Review ${reviewId} not found`);
            throw new Error('Review not found');
        }
        // 验证状态转换合法性
        if (review.status !== 'open' && review.status !== 'updated' && review.status !== 'discussing') {
            logger.error(`Submit feedback failed: Invalid status transition from ${review.status}`);
            throw new Error(`Cannot submit feedback from status: ${review.status}`);
        }
        // 检查是否有未解决的 comments
        const hasUnresolvedComments = review.comments.some(c => !c.resolved);
        if (!hasUnresolvedComments) {
            logger.warn(`Submit feedback: No unresolved comments, consider using approveReview instead`);
        }
        review.status = 'changes_requested';
        await this._save(review);
        logger.info(`Submitted feedback for review ${reviewId}`);
        return review;
    }
    // 用户直接通过（无批注或接受修改）
    async approveReview(reviewId) {
        const review = await this.getReview(reviewId);
        if (!review) {
            logger.error(`Approve review failed: Review ${reviewId} not found`);
            throw new Error('Review not found');
        }
        // 验证状态转换合法性
        if (review.status !== 'open' && review.status !== 'updated') {
            logger.error(`Approve review failed: Invalid status transition from ${review.status}`);
            throw new Error(`Cannot approve from status: ${review.status}`);
        }
        review.status = 'approved';
        await this._save(review);
        logger.info(`Approved review ${reviewId}`);
        return review;
    }
    // Agent 提交 questions
    async askQuestions(reviewId, questions) {
        const review = await this.getReview(reviewId);
        if (!review) {
            logger.error(`Ask questions failed: Review ${reviewId} not found`);
            throw new Error('Review not found');
        }
        // 验证状态
        if (review.status !== 'changes_requested') {
            logger.error(`Ask questions failed: Invalid status ${review.status}, expected changes_requested`);
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
        review.status = 'discussing';
        await this._save(review);
        logger.info(`Asked questions for review ${reviewId}, ${questions.length} questions`);
        return review;
    }
    // 用户回答 question
    async answerQuestion(reviewId, commentId, answer) {
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
    async updatePlanContent(reviewId, newContent, options) {
        const review = await this.getReview(reviewId);
        if (!review) {
            logger.error(`Update plan failed: Review ${reviewId} not found`);
            throw new Error('Review not found');
        }
        // Agent 提交新版本时验证状态
        if (options?.author === 'agent' && review.status !== 'changes_requested') {
            logger.error(`Update plan failed: Agent can only update when status is changes_requested, current: ${review.status}`);
            throw new Error(`Agent cannot update plan from status: ${review.status}`);
        }
        const newVersionHash = this.calculateContentHash(newContent);
        // 如果内容没有变化，直接返回
        if (newVersionHash === review.currentVersion) {
            logger.debug(`Plan content unchanged for review ${reviewId}`);
            return review;
        }
        // 创建新版本
        const newVersion = {
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
        // Agent 提交修订版本时，自动 resolve 所有未解决的评论
        if (options?.author === 'agent' || options?.autoResolveAll) {
            const unresolvedComments = review.comments.filter(c => !c.resolved);
            for (const comment of unresolvedComments) {
                comment.resolved = true;
                comment.resolvedAt = Date.now();
                comment.resolvedInVersion = newVersionHash;
                comment.resolution = '已在修订版本中处理';
            }
            if (unresolvedComments.length > 0) {
                logger.info(`Auto-resolved ${unresolvedComments.length} comments for review ${reviewId}`);
            }
        }
        // 处理显式指定的已解决 comments（覆盖自动解决的 resolution）
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
        // Agent 更新时自动转为 updated 状态
        if (options?.author === 'agent' && review.status === 'changes_requested') {
            review.status = 'updated';
            logger.info(`Review ${reviewId} status changed to updated`);
        }
        // TODO: 调整评论位置（在 Phase 5 实现）
        // await this.adjustCommentPositions(review);
        await this._save(review);
        logger.info(`Updated plan content for review ${reviewId}, new version: ${newVersionHash}`);
        return review;
    }
    // 获取指定版本的文档内容
    getDocumentVersion(review, versionHash) {
        return review.documentVersions.find(v => v.versionHash === versionHash);
    }
    // 获取版本列表（不含内容，用于列表展示）
    getVersionList(review) {
        const currentVersion = review.documentVersions.find(v => v.versionHash === review.currentVersion);
        const currentContent = currentVersion?.content || '';
        return review.documentVersions.map(v => ({
            versionHash: v.versionHash,
            createdAt: v.createdAt,
            changeDescription: v.changeDescription,
            author: v.author,
            isCurrent: v.versionHash === review.currentVersion,
            hasSameContent: v.content === currentContent
        }));
    }
    // 计算两个版本之间的差异
    computeDiff(review, fromHash, toHash) {
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
    computeLCSDiff(oldLines, newLines) {
        const m = oldLines.length;
        const n = newLines.length;
        // 构建 LCS 表
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldLines[i - 1] === newLines[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                }
                else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        // 回溯构建 diff
        const result = [];
        let i = m, j = n;
        const temp = [];
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
            }
            else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                temp.push({
                    type: 'added',
                    content: newLines[j - 1],
                    newLineNumber: j
                });
                j--;
            }
            else {
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
    async rollbackToVersion(reviewId, targetVersionHash) {
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
