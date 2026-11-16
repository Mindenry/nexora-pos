import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { NexoraError } from '@nexora/shared';
import { logger } from '../logger';

interface PgError {
  code?: string;
  detail?: string;
  constraint?: string;
  message?: string;
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'ไม่พบเส้นทางที่ร้องขอ',
      messageTh: 'ไม่พบเส้นทางที่ร้องขอ',
      messageEn: 'Route not found.',
      retryable: false,
    },
  });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  const correlationId = req.ctx?.correlationId ?? String(req.headers['x-request-id'] ?? '');
  const locale = req.ctx?.user.locale ?? 'th';

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.message,
    }));
    res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: locale === 'th' ? 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง' : 'Some fields are invalid.',
        messageTh: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
        messageEn: 'Some fields are invalid.',
        details,
        correlationId,
        retryable: false,
      },
    });
    return;
  }

  if (error instanceof RangeError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: locale === 'th' ? 'ข้อมูลไม่ถูกต้อง' : 'Invalid input.',
        messageTh: 'ข้อมูลไม่ถูกต้อง',
        messageEn: 'Invalid input.',
        details: { code: error.message },
        correlationId,
        retryable: false,
      },
    });
    return;
  }

  if (error instanceof NexoraError) {
    if (error.status >= 500) {
      logger.error('request_failed', {
        code: error.code,
        correlationId,
        path: req.path,
        details: error.details,
      });
    }
    res.status(error.status).json({
      error: {
        code: error.code,
        message: locale === 'th' ? error.messageTh : error.messageEn,
        messageTh: error.messageTh,
        messageEn: error.messageEn,
        details: error.details,
        correlationId,
        retryable: error.retryable,
      },
    });
    return;
  }

  const pgError = error as PgError;
  if (pgError && typeof pgError.code === 'string') {
    if (pgError.code === '23505') {
      res.status(409).json({
        error: {
          code: 'CONFLICT_DUPLICATE',
          message: locale === 'th' ? 'ข้อมูลซ้ำกับที่มีอยู่' : 'This record already exists.',
          messageTh: 'ข้อมูลซ้ำกับที่มีอยู่',
          messageEn: 'This record already exists.',
          details: pgError.constraint ? { constraint: pgError.constraint } : undefined,
          correlationId,
          retryable: false,
        },
      });
      return;
    }
    if (pgError.code === '23503' || pgError.code === '23514' || pgError.code === '22P02') {
      res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: locale === 'th' ? 'ข้อมูลอ้างอิงไม่ถูกต้อง' : 'Referenced data is invalid.',
          messageTh: 'ข้อมูลอ้างอิงไม่ถูกต้อง',
          messageEn: 'Referenced data is invalid.',
          correlationId,
          retryable: false,
        },
      });
      return;
    }
    if (pgError.code === '23001' || pgError.code === '23000') {
      const message = pgError.message ?? '';
      const code = message.includes('SALE_ITEM_IMMUTABLE')
        ? 'DOMAIN_SALE_IMMUTABLE'
        : message.includes('SALE_IMMUTABLE')
          ? 'DOMAIN_SALE_IMMUTABLE'
          : 'DOMAIN_IMMUTABLE_RECORD';
      res.status(409).json({
        error: {
          code,
          message:
            locale === 'th'
              ? 'รายการนี้แก้ไขไม่ได้หลังบันทึกแล้ว'
              : 'This record is immutable once committed.',
          messageTh: 'รายการนี้แก้ไขไม่ได้หลังบันทึกแล้ว',
          messageEn: 'This record is immutable once committed.',
          correlationId,
          retryable: false,
        },
      });
      return;
    }
  }

  logger.error('unhandled_error', {
    correlationId,
    path: req.path,
    method: req.method,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  res.status(500).json({
    error: {
      code: 'INFRA_INTERNAL',
      message: locale === 'th' ? 'เกิดข้อผิดพลาดภายในระบบ' : 'Internal error.',
      messageTh: 'เกิดข้อผิดพลาดภายในระบบ',
      messageEn: 'Internal error.',
      correlationId,
      retryable: true,
    },
  });
}

export function assertFound<T>(value: T | null | undefined, errorCode = 'NOT_FOUND'): T {
  if (value === null || value === undefined) throw new NexoraError(errorCode);
  return value;
}
