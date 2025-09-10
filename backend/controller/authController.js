import { prisma } from '../prisma/prisma_lib.js';

import bcrypt from 'bcrypt';
import { generateToken } from '../services/jwtService.js';
import sanitizeHtml from 'sanitize-html';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import crypto from 'crypto';
import {notFoundError, AuthenticationError} from '../utils/errors.js'
import validator from 'validator'

const sanitizedUserSelect = { id: true, username: true, email: true, createdAt: true, lastSeen: true, updatedAt: true }

function generateBackupCodes(count = 5) {
    return Array.from({ length: count }, () =>
        crypto.randomBytes(4).toString('hex')
    );
}

export async function registerUser(req, reply) {
    const { username, email, password } = req.body;

    // Sanitize input to prevent XSS
    const cleanUsername = sanitizeHtml(username);
    const cleanEmail = sanitizeHtml(email).toLowerCase();

    if (!validator.isAlphanumeric(cleanUsername))
        throw new ValidationError("username should consist of letters and digits")
    
    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
        where: {
            OR: [
                { username: cleanUsername },
                { email: cleanEmail }
            ]
        }
    });

    if (existingUser) {
        if (existingUser.username === cleanUsername) {
            return reply.status(409).send({ error: 'Username already exists' });
        }
        if (existingUser.email === cleanEmail) {
            return reply.status(409).send({ error: 'this email is already registered with' });
        }
    }

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const user = await prisma.user.create({
        data: {
            username: cleanUsername,
            email: cleanEmail,
            passwordHash
        }
    });

    return reply.status(201).send({
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            lastSeen: user.lastSeen,
            gamesPlayed: user.gamesPlayed,
            wins: user.wins,
            losses: user.losses
        }
    });
}

export async function login(req, reply) {
    const { email, password, twoFactorCode } = req.body;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new AuthenticationError("Invalid email or password.");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AuthenticationError("Invalid email or password.");

    // Check if 2FA is enabled
    if (user.isTwoFactorEnabled) {
        let verified = false;
        let backupCodesArray = [];

        if (user.twoFactorBackupCodes) {
            try {
                backupCodesArray = JSON.parse(user.twoFactorBackupCodes);
            } catch (e) {
                backupCodesArray = [];
            }
        }

        // Verify 2FA code
        if (twoFactorCode) {
            verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: twoFactorCode
            });

            // If not verified, check backup codes
            if (!verified && backupCodesArray.includes(twoFactorCode)) {
                // Remove used backup code
                const updatedCodes = backupCodesArray.filter(code => code !== twoFactorCode);
                await prisma.user.update({
                    where: { id: user.id },
                    data: { twoFactorBackupCodes: JSON.stringify(updatedCodes) }
                });
                verified = true;
            }
        }

        if (!verified) throw new AuthenticationError("Invalid 2FA or backup code.");
    }

    const token = generateToken(user);
    const isLocalhost = req.headers.host === 'localhost' || req.headers.host === '127.0.0.1';

    reply.setCookie('token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 3600,
        ...(isLocalhost ? { domain: 'localhost' } : {})
    });

    // reply.send({ message: 'Login successful' });

    reply.send({
        message: 'Login successful',
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            isTwoFactorEnabled: user.isTwoFactorEnabled // Include 2FA status
        }
    });
}

export async function getCurrentUser(req, reply) {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user)
        return new notFoundError('User not found')
    return reply.status(200).send({
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            lastSeen: user.lastSeen
        }
    });
}

export function logout(req, reply) {
    reply.clearCookie('token', { 
        path: '/',
        secure: true,
        sameSite: 'lax',
        // domain: 'localhost'
    });
    return reply.status(200).send({ message: "logged-out" });
}

export async function refreshToken(req, reply) {

    const userId = req.user.id;
    const user = await prisma.user.findUnique({ 
        where: { id: userId },
        select: {
            id: true,
            username: true,
            email: true,
            createdAt: true,
            updatedAt: true,
            lastSeen: true,
            gamesPlayed: true,
            wins: true,
            losses: true,
            avatarUrl: true
        }
    });
    
    if (!user)
        throw new notFoundError("User not found")
    
    // Generate new token
    const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1';

    reply.setCookie('token', token, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 3600,
        ...(isLocalhost ?  { domain: 'localhost' }: {})
    });
    
    // Update last seen
    await prisma.user.update({
        where: { id: user.id }, 
        data: { lastSeen: new Date() }
    });
    
    return reply.status(200).send({ 
        message: 'Token refreshed successfully',
        user: user
    });
}

export async function setup2FA(req, reply) {
    const userId = req.user.id;
    const secret = speakeasy.generateSecret({ name: `ft_transcendence (${req.user.email})` });

    // Save secret to user in DB
    const backupCodesArray = generateBackupCodes();

    await prisma.user.update({
        where: { id: userId },
        data: {
            twoFactorSecret: secret.base32,
            isTwoFactorEnabled: true,
            twoFactorBackupCodes: JSON.stringify(backupCodesArray)
        }
    });

    const qr = qrcode.toDataURL(secret.otpauth_url);

    // Return backupCodesArray to the user (show only once!)
    return reply.send({ qr, secret: secret.base32, backupCodes: backupCodesArray });
}

fastify.post('/auth/setup-2fa', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user.id;

    // Generate a 2FA secret
    const secret = speakeasy.generateSecret({
        name: `Powerpuff Pong (${req.user.email})`,
    });

    // Save the secret to the database
    await prisma.user.update({
        where: { id: userId },
        data: { twoFactorSecret: secret.base32, isTwoFactorEnabled: true },
    });

    // Generate a QR code for the secret
    const qrCode = await qrcode.toDataURL(secret.otpauth_url);

    // Return the QR code to the frontend
    reply.send({ qrCode });
});
