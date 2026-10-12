import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import helmet from '@fastify/helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ServerTimingInterceptor } from './common/interceptors/server-timing.interceptor';

export async function configureApp(app: NestFastifyApplication) {
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  const allowedDevOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];

  const configuredFrontend = process.env.FRONTEND_URL?.trim();
  const additionalOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  const allowedOrigins = Array.from(
    new Set([
      ...allowedDevOrigins,
      ...(configuredFrontend ? [configuredFrontend] : []),
      ...additionalOrigins,
    ]),
  );

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile native apps, curl, server-to-server)
      if (!origin) {
        return callback(null, true);
      }
      if (
        allowedOrigins.includes(origin) ||
        (process.env.NODE_ENV !== 'production' &&
          /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With',
      'X-Request-Id',
      'x-request-id',
    ],
    exposedHeaders: ['Server-Timing', 'X-Request-Id', 'x-request-id'],
    maxAge: 86400,
  });

  // All API endpoints will begin with /v1
  app.setGlobalPrefix('v1');

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Server Timing & Trace ID instrumentation
  app.useGlobalInterceptors(new ServerTimingInterceptor());

  // Swagger API documentation
  const config = new DocumentBuilder()
    .setTitle('Bright & White API')
    .setDescription('Bright & White Laundry Management API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document);
}
