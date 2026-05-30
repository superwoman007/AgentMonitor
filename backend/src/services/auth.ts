import { QueryResultRow } from 'pg';
import { query, queryOne } from '../db/index.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';

export interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuthTokens {
  token: string;
  refreshToken: string;
  user: User;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < config.security.passwordMinLength) {
    return `Password must be at least ${config.security.passwordMinLength} characters`;
  }
  if (config.security.passwordRequireUppercase && !/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (config.security.passwordRequireNumber && !/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  if (config.security.passwordRequireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return 'Password must contain at least one special character';
  }
  return null;
}

export function signToken(userId: string): string {
  return jwt.sign({ userId, type: 'access' }, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiresIn as string,
  } as jwt.SignOptions);
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: 'refresh' }, config.jwt.secret, {
    expiresIn: config.jwt.refreshExpiresIn as string,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): { userId: string; type?: string } | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as { userId: string; type?: string };
    return decoded;
  } catch {
    return null;
  }
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function register(email: string, password: string, name?: string): Promise<AuthTokens> {
  if (!validateEmail(email)) {
    throw new Error('Invalid email format');
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    throw new Error(passwordError);
  }

  const existingUser = await queryOne<{ id: string } & QueryResultRow>(
    'SELECT id FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (existingUser) {
    throw new Error('Email already registered');
  }

  const passwordHash = await hashPassword(password);
  const userId = uuidv4();

  const user = await queryOne<User & QueryResultRow>(
    `INSERT INTO users (id, email, password_hash, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, created_at, updated_at`,
    [userId, email.toLowerCase(), passwordHash, name || null]
  );

  if (!user) {
    throw new Error('Failed to create user');
  }

  return {
    token: signToken(user.id),
    refreshToken: signRefreshToken(user.id),
    user,
  };
}

export async function login(email: string, password: string): Promise<AuthTokens> {
  const user = await queryOne<(User & { password_hash: string }) & QueryResultRow>(
    'SELECT id, email, name, password_hash, created_at, updated_at FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (!user) {
    throw new Error('Invalid credentials');
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    throw new Error('Invalid credentials');
  }

  const { password_hash: _, ...userWithoutPassword } = user;

  return {
    token: signToken(user.id),
    refreshToken: signRefreshToken(user.id),
    user: userWithoutPassword,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ token: string; refreshToken: string }> {
  const payload = verifyToken(refreshToken);
  if (!payload || payload.type !== 'refresh') {
    throw new Error('Invalid refresh token');
  }

  const user = await getUserById(payload.userId);
  if (!user) {
    throw new Error('User not found');
  }

  return {
    token: signToken(user.id),
    refreshToken: signRefreshToken(user.id),
  };
}

export async function getUserById(userId: string): Promise<User | null> {
  return queryOne<User & QueryResultRow>(
    'SELECT id, email, name, created_at, updated_at FROM users WHERE id = $1',
    [userId]
  );
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return queryOne<User & QueryResultRow>(
    'SELECT id, email, name, created_at, updated_at FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
}
