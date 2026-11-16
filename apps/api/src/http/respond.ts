import type { Response } from 'express';

export function ok<T>(res: Response, data: T, meta?: unknown): void {
  res.json(meta === undefined ? { data } : { data, meta });
}

export function created<T>(res: Response, data: T): void {
  res.status(201).json({ data });
}

export function noContent(res: Response): void {
  res.status(204).end();
}

export function csv(res: Response, filename: string, content: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // UTF-8 BOM keeps Thai text readable in Excel.
  res.send(`\uFEFF${content}`);
}
