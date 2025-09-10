import {
  registerUser,
  login,
  logout,
  setup2FA,
  refreshToken
} from '../controller/authController.js';

import {
  handleGoogleAuth,
  handleGoogleCallback
} from '../services/googleAuthService.js';

import {
  registerUserOpts,
  loginOpts,
  logoutOpts,
} from '../schema/authSchema.js';
import { authenticate } from '../services/jwtService.js';
import speakeasy from 'speakeasy';
import { prisma } from '../prisma/prisma_lib.js';

export default function authRoutes(fastify, _opts, done) {
  fastify.post('/auth/registerUser', registerUserOpts, registerUser);
  fastify.post('/auth/login', loginOpts, login);
  fastify.post('/auth/logout', {preHandler: authenticate}, logout);
  fastify.post('/auth/refresh', {preHandler: authenticate}, refreshToken);
  fastify.post('/auth/setup-2fa', { preHandler: authenticate }, setup2FA);

  // Google OAuth endpoints
  fastify.get('/auth/google', handleGoogleAuth);
  fastify.get('/auth/google/callback', handleGoogleCallback);

  fastify.post('/auth/verify-2fa', { preHandler: authenticate }, async (req, reply) => {
    const { twoFactorCode } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (!user || !user.twoFactorSecret) {
      return reply.status(400).send({ error: '2FA is not enabled for this account.' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: twoFactorCode,
    });

    if (!verified) {
      return reply.status(400).send({ error: 'Invalid 2FA code.' });
    }

    reply.send({ message: '2FA verified successfully.' });
  });

  done();
}
