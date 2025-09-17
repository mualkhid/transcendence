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

// Updated login function to handle 2FA
// export async function login(req, reply) {
//     const { email, password, twoFactorCode } = req.body;

//     const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
//     if (!user) throw new AuthenticationError("Invalid email or password.");

//     const valid = await bcrypt.compare(password, user.passwordHash);
//     if (!valid) throw new AuthenticationError("Invalid email or password.");

//     // Check if 2FA is enabled
//     if (user.isTwoFactorEnabled) {
//         if (!twoFactorCode) {
//             return reply.status(401).send({
//                 require2FA: true,
//                 message: 'Two-factor authentication required'
//             });
//         }

//         let verified = false;
//         let backupCodesArray = [];

//         if (user.twoFactorBackupCodes) {
//             try {
//                 backupCodesArray = JSON.parse(user.twoFactorBackupCodes);
//             } catch (e) {
//                 backupCodesArray = [];
//             }
//         }

//         // Verify TOTP code
//         verified = speakeasy.totp.verify({
//             secret: user.twoFactorSecret,
//             encoding: 'base32',
//             token: twoFactorCode,
//             window: 2
//         });

//         // Check backup codes if TOTP failed
//         if (!verified && backupCodesArray.includes(twoFactorCode)) {
//             const updatedCodes = backupCodesArray.filter(code => code !== twoFactorCode);
//             await prisma.user.update({
//                 where: { id: user.id },
//                 data: { twoFactorBackupCodes: JSON.stringify(updatedCodes) }
//             });
//             verified = true;
//         }

//         if (!verified) {
//             throw new AuthenticationError("Invalid 2FA code or backup code.");
//         }
//     }

//     // Continue with normal login flow...
//     const token = generateToken(user);
//     const isLocalhost = req.headers.host?.includes('localhost') || req.headers.host?.includes('127.0.0.1');

//     reply.setCookie('token', token, {
//         httpOnly: true,
//         secure: true,
//         sameSite: 'lax',
//         path: '/',
//         maxAge: 3600,
//         ...(isLocalhost ? { domain: 'localhost' } : {})
//     });

//     reply.send({
//         message: 'Login successful',
//         user: {
//             id: user.id,
//             username: user.username,
//             email: user.email,
//             isTwoFactorEnabled: user.isTwoFactorEnabled,
//             avatarUrl: user.avatarUrl,
//             gamesPlayed: user.gamesPlayed,
//             wins: user.wins,
//             losses: user.losses
//         }
//     });
// }
export async function login(req, reply) {
    console.log('=== LOGIN REQUEST DEBUG ===');
    const { email, password, twoFactorCode } = req.body;
    console.log('Request body:', { email, hasPassword: !!password, twoFactorCode });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
        console.log('❌ User not found for email:', email);
        throw new AuthenticationError("Invalid email or password.");
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
        console.log('❌ Invalid password for user:', email);
        throw new AuthenticationError("Invalid email or password.");
    }

    console.log('✅ Email/password valid. User 2FA status:', user.isTwoFactorEnabled);

    // Check if 2FA is enabled
    if (user.isTwoFactorEnabled) {
        if (!twoFactorCode) {
            console.log('🔐 2FA required, no code provided - showing 2FA form');
            return reply.status(401).send({
                require2FA: true,
                message: 'Two-factor authentication required'
            });
        }

        console.log('🔍 Verifying 2FA code:', twoFactorCode);
        console.log('🔑 User 2FA secret exists:', !!user.twoFactorSecret);
        
        let verified = false;
        let backupCodesArray = [];

        if (user.twoFactorBackupCodes) {
            try {
                backupCodesArray = JSON.parse(user.twoFactorBackupCodes);
                console.log('📱 Available backup codes count:', backupCodesArray.length);
            } catch (e) {
                console.log('⚠️ Error parsing backup codes:', e.message);
                backupCodesArray = [];
            }
        }

        // Verify TOTP code
        verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: twoFactorCode,
            window: 2
        });

        console.log('🔐 TOTP verification result:', verified);

        // Check backup codes if TOTP failed
        if (!verified && backupCodesArray.includes(twoFactorCode)) {
            console.log('✅ Backup code verified, removing from list');
            const updatedCodes = backupCodesArray.filter(code => code !== twoFactorCode);
            await prisma.user.update({
                where: { id: user.id },
                data: { twoFactorBackupCodes: JSON.stringify(updatedCodes) }
            });
            verified = true;
        }

        if (!verified) {
            console.log('❌ 2FA verification failed for code:', twoFactorCode);
            console.log('Available backup codes:', backupCodesArray);
            throw new AuthenticationError("Invalid 2FA code or backup code.");
        }
        
        console.log('✅ 2FA verification successful');
    }

    // Continue with normal login flow...
    console.log('🎉 Login successful, generating token');
    const token = generateToken(user);
    
    const isLocalhost = req.headers.host?.includes('localhost') || req.headers.host?.includes('127.0.0.1');

    reply.setCookie('token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 3600,
        ...(isLocalhost ? { domain: 'localhost' } : {})
    });

    console.log('✅ Cookie set, sending response');
    reply.send({
        message: 'Login successful',
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            isTwoFactorEnabled: user.isTwoFactorEnabled,
            avatarUrl: user.avatarUrl,
            gamesPlayed: user.gamesPlayed,
            wins: user.wins,
            losses: user.losses
        }
    });
    console.log('=== LOGIN REQUEST COMPLETE ===');
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
            lastSeen: user.lastSeen,
            isTwoFactorEnabled: user.isTwoFactorEnabled,
            gamesPlayed: user.gamesPlayed,
            wins: user.wins,
            losses: user.losses,
            avatarUrl: user.avatarUrl
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
            avatarUrl: true,
            isTwoFactorEnabled: true
        }
    });
    
    if (!user)
        throw new notFoundError("User not found")
    
    // Generate new token
    const token = generateToken(user);
    
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

// Setup 2FA
export async function setup2FA(req, reply) {
    try {
        const userId = req.user.id;
        
        // Check if user already has 2FA enabled
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { isTwoFactorEnabled: true, twoFactorSecret: true }
        });

        if (user.isTwoFactorEnabled) {
            return reply.status(400).send({ error: '2FA is already enabled' });
        }

        // Generate secret
        const secret = speakeasy.generateSecret({
            name: `Transcendence (${req.user.email || req.user.username})`,
            issuer: 'ft_transcendence'
        });

        // Generate QR code
        const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

        // Generate backup codes
        const backupCodes = [];
        for (let i = 0; i < 10; i++) {
            backupCodes.push(Math.random().toString(36).substring(2, 8).toUpperCase());
        }

        // Store the secret and backup codes in database (but don't enable 2FA yet)
        await prisma.user.update({
            where: { id: userId },
            data: {
                twoFactorSecret: secret.base32,
                twoFactorBackupCodes: JSON.stringify(backupCodes),
                isTwoFactorEnabled: false // Will be enabled after verification
            }
        });

        reply.send({
            qr: qrCodeUrl,
            secret: secret.base32,
            backupCodes: backupCodes
        });
    } catch (error) {
        console.error('Setup 2FA error:', error);
        reply.status(500).send({ error: 'Failed to setup 2FA' });
    }
}

// Verify 2FA code and enable 2FA
export async function verify2FA(req, reply) {
    try {
        const { twoFactorCode } = req.body;
        const userId = req.user.id;

        if (!twoFactorCode) {
            return reply.status(400).send({ error: 'Two-factor code is required' });
        }

        // Get user's secret
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { twoFactorSecret: true, isTwoFactorEnabled: true }
        });

        if (!user || !user.twoFactorSecret) {
            return reply.status(400).send({ error: 'Two-factor authentication not set up' });
        }

        if (user.isTwoFactorEnabled) {
            return reply.status(400).send({ error: 'Two-factor authentication already enabled' });
        }

        // Verify the TOTP code
        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: twoFactorCode,
            window: 2
        });

        if (!verified) {
            return reply.status(400).send({ error: 'Invalid verification code' });
        }

        // Enable 2FA
        await prisma.user.update({
            where: { id: userId },
            data: { isTwoFactorEnabled: true }
        });

        reply.send({ message: '2FA enabled successfully' });
    } catch (error) {
        console.error('Verify 2FA error:', error);
        reply.status(500).send({ error: 'Failed to verify 2FA' });
    }
}

// Disable 2FA
export async function disable2FA(req, reply) {
    try {
        const userId = req.user.id;

        // Disable 2FA and clear secrets
        await prisma.user.update({
            where: { id: userId },
            data: {
                isTwoFactorEnabled: false,
                twoFactorSecret: null,
                twoFactorBackupCodes: null
            }
        });

        reply.send({ message: '2FA disabled successfully' });
    } catch (error) {
        console.error('Disable 2FA error:', error);
        reply.status(500).send({ error: 'Failed to disable 2FA' });
    }
}
