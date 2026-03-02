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
  user: User;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, config.jwt.secret, { 
    expiresIn: '7d' 
  });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as { userId: string };
    return decoded;
  } catch {
    return null;
  }
}

export async function register(email: string, password: string, name?: string): Promise<AuthTokens> {
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
    user: userWithoutPassword,
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
