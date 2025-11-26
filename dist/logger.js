import { format } from 'util';
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
export class Logger {
    level;
    constructor(level = LogLevel.INFO) {
        this.level = level;
    }
    log(level, message, ...args) {
        if (level < this.level)
            return;
        const timestamp = new Date().toISOString();
        const levelStr = LogLevel[level];
        const formattedMessage = format(message, ...args);
        // MCP servers communicate via stdio, so we must write logs to stderr
        // to avoid interfering with the protocol messages on stdout.
        console.error(`[${timestamp}] [${levelStr}] ${formattedMessage}`);
    }
    debug(message, ...args) {
        this.log(LogLevel.DEBUG, message, ...args);
    }
    info(message, ...args) {
        this.log(LogLevel.INFO, message, ...args);
    }
    warn(message, ...args) {
        this.log(LogLevel.WARN, message, ...args);
    }
    error(message, ...args) {
        this.log(LogLevel.ERROR, message, ...args);
    }
}
export const logger = new Logger(process.env.DEBUG ? LogLevel.DEBUG : LogLevel.INFO);
