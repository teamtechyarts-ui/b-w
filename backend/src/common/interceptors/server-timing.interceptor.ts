import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import * as crypto from 'crypto';

@Injectable()
export class ServerTimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = performance.now();
    const http = context.switchToHttp();
    const request = http.getRequest<any>();
    const reply = http.getResponse<any>();

    // Assign or preserve trace / request ID
    const incomingReqId =
      request.headers?.['x-request-id'] ||
      request.headers?.['x-trace-id'];
    const requestId =
      typeof incomingReqId === 'string' && incomingReqId.trim()
        ? incomingReqId.trim()
        : crypto.randomUUID();

    request.requestId = requestId;

    return next.handle().pipe(
      tap(() => {
        const duration = (performance.now() - start).toFixed(1);
        try {
          if (reply && typeof reply.header === 'function') {
            reply.header('x-request-id', requestId);
            reply.header('Server-Timing', `total;dur=${duration}`);
          }
        } catch {
          // Response headers already sent
        }
      }),
    );
  }
}
