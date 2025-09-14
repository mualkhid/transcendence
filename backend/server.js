import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cookie from '@fastify/cookie';
import fs from 'fs';
import https from 'https';


import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/users.js';
import tournamentRoutes from './routes/tournament.js';
import remoteGameRoutes from './routes/remoteGameRoutes.js';
import friendsRoutes from './routes/friendsRoute.js';
import profileRoutes from './routes/profileRoutes.js';
import aiGameRoutes from './routes/aiGameRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';

import { globalErrorHandler } from './utils/errorHandler.js';
import { setupWebSocketServer } from './services/webSocketService.js';
import { prisma } from './prisma/prisma_lib.js';
import { setupGracefulShutdown } from './utils/gracefulShutdown.js';

dotenv.config();

const fastify = Fastify();
fastify.setErrorHandler(globalErrorHandler);

// Needed to get __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


fastify.addHook('onRequest', (request, reply, done) => {
    console.log("---- Incoming Request ----");
    console.log("Method:", request.method);
    console.log("URL:", request.url);
    console.log("Origin:", request.headers.origin || "N/A");
    console.log("Access-Control-Request-Method:", request.headers["access-control-request-method"] || "N/A");
    console.log("Access-Control-Request-Headers:", request.headers["access-control-request-headers"] || "N/A");
    console.log("All Headers:", request.headers);
    console.log("--------------------------");
    done ()
})

await fastify.register(cookie);
  
  // 2) CORS (allow 10.11.* + localhost; works with credentials)
  await fastify.register(cors, {
    origin: '*',
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    // credenials: true,
    allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
  });
  




fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/', 
});

await fastify.register(fastifyWebsocket);

fastify.register(swagger, {
  swagger: {
    info: { title: 'fastify-api', version: '1.0.0' },
  },
});


fastify.register(fastifyMultipart, {
  limits: { file: 1, filesize: 5 * 1024 * 1024 },
});

fastify.register(swaggerUI, {
  routePrefix: '/docs',
  exposeRoute: true,
});

await fastify.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false
});

// Security + Rate limiting
fastify.register(rateLimit, {
  max: 20,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1', ''],
  skip: (request) => request.headers.upgrade && request.headers.upgrade.toLowerCase() === 'websocket'
});

// 🔹 Register routes
fastify.register(tournamentRoutes, { prefix: '/api' });
fastify.register(authRoutes, { prefix: '/api' });
fastify.register(userRoutes, { prefix: '/api' });
fastify.register(friendsRoutes, { prefix: '/api' });
fastify.register(profileRoutes, { prefix: '/api' });
fastify.register(remoteGameRoutes, { prefix: '/api' });
fastify.register(aiGameRoutes, { prefix: '/api' });
fastify.register(dashboardRoutes, { prefix: '/api' });

// Also register without prefix for testing
fastify.register(remoteGameRoutes);

// 🔹 Start server LAST
setupGracefulShutdown(fastify, prisma);
console.log('Attempting to start server...');
const address = await fastify.listen({ port: 3000, host: '0.0.0.0' });
console.log(`Server running at ${address}`);

// Set up the separate WebSocket server
setupWebSocketServer();

console.log('✅ Server started successfully');

// HTTPS server setup
const sslOptions = {
  key: fs.readFileSync('security/ssl/server.key'),
  cert: fs.readFileSync('security/ssl/server.crt'),
};

https.createServer(sslOptions, fastify).listen(3000, () => {
  console.log('HTTPS server running on https://localhost:3000');
});

