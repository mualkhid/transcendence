import { deleteUser, anonymizeUser, getUserData } from '../controller/userController.js';
import { setup2FA } from '../controller/authController.js';
import { registerSchema, deleteAccountSchema, anonymizeAccountSchema } from '../schema/userSchema.js';
import { authenticate } from '../services/jwtService.js';

export default async function userRoutes(fastify, options) {
    // Removed conflicting /register route - using /auth/registerUser instead
    fastify.delete('/user/delete', { preHandler: authenticate, schema: deleteAccountSchema }, deleteUser);
    fastify.post('/user/anonymize', {preHandler: authenticate}, anonymizeUser);
    fastify.get('/user/data', {preHandler: authenticate}, getUserData);
    // fastify.post('/auth/setup-2fa', { preHandler: [authenticate] }, setup2FA);
}
