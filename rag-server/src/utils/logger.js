const winston = require('winston');

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

exports.logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat)
    }),
    new winston.transports.File({
      filename: '/var/log/rag/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3
    }),
    new winston.transports.File({
      filename: '/var/log/rag/combined.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    })
  ]
});
