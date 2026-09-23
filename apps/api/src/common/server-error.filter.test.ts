import {
  type ArgumentsHost,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { ServerErrorFilter } from './server-error.filter.js';

function setup() {
  const httpAdapter = { reply: vi.fn(), isHeadersSent: () => false, end: vi.fn() };
  const reporter = { report: vi.fn(), flush: vi.fn() };
  const filter = new ServerErrorFilter({ httpAdapter } as unknown as HttpAdapterHost, reporter);
  const request = { id: 'req-abc', method: 'POST', routeOptions: { url: '/v1/checkout' } };
  const host = {
    getType: () => 'http',
    getArgByIndex: (index: number) => (index === 0 ? request : {}),
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
  } as unknown as ArgumentsHost;
  return { filter, reporter, httpAdapter, host };
}

describe('ServerErrorFilter', () => {
  it('reports an unexpected error with the route pattern and request id, then answers 500', () => {
    const { filter, reporter, httpAdapter, host } = setup();
    const error = new Error('boom');

    filter.catch(error, host);

    expect(reporter.report).toHaveBeenCalledWith(error, {
      status: 500,
      method: 'POST',
      route: '/v1/checkout',
      requestId: 'req-abc',
    });
    expect(httpAdapter.reply.mock.calls[0]?.[2]).toBe(500);
  });

  it('reports a 5xx HttpException', () => {
    const { filter, reporter, host } = setup();
    filter.catch(new ServiceUnavailableException(), host);
    expect(reporter.report).toHaveBeenCalledOnce();
  });

  it('does not report the caller’s mistakes, and answers them unchanged', () => {
    const { filter, reporter, httpAdapter, host } = setup();
    filter.catch(new BadRequestException('nope'), host);
    expect(reporter.report).not.toHaveBeenCalled();
    expect(httpAdapter.reply.mock.calls[0]?.[2]).toBe(400);
  });
});
